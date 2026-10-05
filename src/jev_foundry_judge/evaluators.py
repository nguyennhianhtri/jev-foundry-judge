"""Foundry-compatible evaluators that use Jev (TypeSafe System One) as the judge.

Each evaluator is a callable class with the same keyword inputs as the matching
azure-ai-evaluation built-in (query, response, tool_definitions, tool_calls, context)
and returns the same result-key family (``<key>``, ``<key>_score``, ``<key>_result``,
``<key>_passed``, ``<key>_threshold``, ``<key>_reason``) plus ``<key>_confidence`` and
``<key>_properties`` (atomic answers, tokens, latency, cost).

Every metric is decomposed into atomic Jev questions (Score / Noul / Choice) that
are all answered in ONE Jev call against a shared structured state. The final score is
combined in plain code with published weights, so the judgement is auditable: the
``_reason`` field is built from the atomic checks, not from generated prose.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from .jev_client import JevClient, JevResult

LIKERT = 5  # Foundry agent evaluators use a 1-5 scale with default threshold 3


# --------------------------------------------------------------------------- inputs
def _as_text(x: Any) -> str:
    if x is None:
        return ""
    if isinstance(x, str):
        return x
    return json.dumps(x, ensure_ascii=False)


def _messages(x: Any) -> list[dict]:
    if isinstance(x, list):
        return [m for m in x if isinstance(m, dict)]
    if isinstance(x, str) and x.strip():
        return [{"role": "user", "content": x}]
    return []


def _extract_tool_calls(response: Any, tool_calls: Any) -> list[dict]:
    """Accept Foundry agent message format, OpenAI tool_calls, or a flat list."""
    calls: list[dict] = []
    src = tool_calls if tool_calls else response
    if isinstance(src, dict):
        src = [src]
    if not isinstance(src, list):
        return calls
    for m in src:
        if not isinstance(m, dict):
            continue
        if m.get("type") in ("tool_call", "function_call") or ("name" in m and "arguments" in m):
            calls.append({"name": m.get("name"), "arguments": m.get("arguments")})
        for c in m.get("content", []) if isinstance(m.get("content"), list) else []:
            if isinstance(c, dict) and c.get("type") in ("tool_call", "function_call"):
                calls.append({"name": c.get("name"), "arguments": c.get("arguments")})
        for c in m.get("tool_calls", []) or []:
            f = c.get("function", c)
            calls.append({"name": f.get("name"), "arguments": f.get("arguments")})
    return calls


def _extract_tool_results(response: Any) -> list[Any]:
    out = []
    if isinstance(response, list):
        for m in response:
            if not isinstance(m, dict):
                continue
            if m.get("role") == "tool":
                c = m.get("content")
                if isinstance(c, list):
                    out += [x.get("tool_result", x) for x in c if isinstance(x, dict)]
                else:
                    out.append(c)
    return out


def _final_answer(response: Any) -> str:
    if isinstance(response, str):
        return response
    if isinstance(response, list):
        for m in reversed(response):
            if isinstance(m, dict) and m.get("role") == "assistant":
                c = m.get("content")
                if isinstance(c, str) and c.strip():
                    return c
                if isinstance(c, list):
                    t = " ".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")
                    if t.strip():
                        return t
    return _as_text(response)


def build_state(query=None, response=None, tool_definitions=None, tool_calls=None, context=None) -> dict:
    """One structured state shared by every atomic question (Jev fan-out pattern)."""
    msgs = _messages(query)
    system = " ".join(_as_text(m.get("content")) for m in msgs if m.get("role") == "system")
    user = [m for m in msgs if m.get("role") != "system"] or query
    state: dict[str, Any] = {
        "system_instructions": system or "(none provided)",
        "conversation": user if isinstance(user, list) else _as_text(user),
        "agent_final_answer": _final_answer(response),
    }
    calls = _extract_tool_calls(response, tool_calls)
    results = _extract_tool_results(response)
    if tool_definitions:
        state["available_tools"] = tool_definitions
    if calls:
        state["agent_tool_calls"] = calls
    if results:
        state["tool_results"] = results
    if context:
        state["reference_context"] = context
    return state


# --------------------------------------------------------------------------- metric specs
@dataclass
class Atom:
    key: str
    question: dict
    weight: float
    invert: bool = False           # a "yes" is bad (e.g. hallucinated claim)
    critical: bool = False         # a confident failure caps the score
    label: str = ""


LEVELS_5 = {
    "intent_resolution": [
        "1 - Response ignores or misreads what the user wanted",
        "2 - Response touches the intent but mostly fails to resolve it",
        "3 - Response resolves the main intent with notable gaps",
        "4 - Response resolves the intent with minor gaps",
        "5 - Response fully and precisely resolves every part of the user's intent",
    ],
    "task_adherence": [
        "1 - Violates the system instructions, policy or scope",
        "2 - Mostly off-task or breaks an important rule",
        "3 - On task but bends a rule or skips a required step",
        "4 - Follows instructions with a minor lapse",
        "5 - Follows every instruction, rule and required step",
    ],
    "tool_call_accuracy": [
        "1 - Wrong tools, or needed tools never called",
        "2 - Some relevant calls but with major parameter errors or missing calls",
        "3 - Mostly right calls with a notable error, redundancy or omission",
        "4 - Right calls with a minor issue",
        "5 - Exactly the needed tools, correct grounded parameters, no redundancy",
    ],
    "groundedness": [
        "1 - Answer is largely unsupported by, or contradicts, the available evidence",
        "2 - Several claims are unsupported by the evidence",
        "3 - Mostly supported with one unsupported claim",
        "4 - Supported with only trivial unsupported detail",
        "5 - Every factual claim is supported by the available evidence",
    ],
}


def _noul(q: str, yes: str | None = None, no: str | None = None) -> dict:
    d: dict = {"type": "noul", "instructions": q}
    if yes or no:
        d["criteria"] = {"true": yes or "yes", "false": no or "no"}
    return d


def _score(metric: str, q: str) -> dict:
    return {"type": "score", "instructions": q, "criteria": LEVELS_5[metric]}


SPECS: dict[str, dict] = {
    "intent_resolution": {
        "requires": lambda s: True,
        "atoms": [
            Atom("overall", _score("intent_resolution",
                 "Judge the `agent_final_answer` against the latest user request in `conversation`. How well does it resolve what the user actually wanted?"), 0.55, label="overall resolution"),
            Atom("identified", _noul("Does the `agent_final_answer` show the agent correctly understood what the user is asking for in `conversation`?"), 0.15, critical=True, label="intent identified"),
            Atom("all_parts", _noul("Does the `agent_final_answer` address every distinct part of the user's latest request in `conversation`?"), 0.15, label="all parts addressed"),
            Atom("actionable", _noul("Would the user be able to act on or be satisfied by the `agent_final_answer` without having to ask again?"), 0.15, label="user can act on it"),
        ],
    },
    "task_adherence": {
        "requires": lambda s: True,
        "atoms": [
            Atom("overall", _score("task_adherence",
                 "Judge the agent's behaviour (`agent_tool_calls` if any, and `agent_final_answer`) against `system_instructions` and the user's task. How well did it adhere?"), 0.4, label="overall adherence"),
            Atom("rules", _noul("Did the agent break any rule, restriction or policy stated in `system_instructions`?"), 0.2, invert=True, critical=True, label="broke a system rule"),
            Atom("scope", _noul("Did the agent go outside the task scope defined by `system_instructions` or the user's request?"), 0.1, invert=True, label="went out of scope"),
            Atom("unverified", _noul("Does the `agent_final_answer` state an account-, order- or record-specific fact that no tool result or provided context supports?"), 0.15, invert=True, label="asserted unverified specifics"),
            Atom("steps", _noul("Did the agent perform the steps required by `system_instructions` (for example verifying, confirming or asking) before acting?"), 0.15, label="required steps done"),
        ],
    },
    "tool_call_accuracy": {
        "requires": lambda s: bool(s.get("agent_tool_calls")) or bool(s.get("available_tools")),
        "atoms": [
            Atom("overall", _score("tool_call_accuracy",
                 "Judge `agent_tool_calls` against the user's request and `available_tools`. How accurate were the tool calls?"), 0.4, label="overall tool use"),
            Atom("selection", _noul("Are the tools named in `agent_tool_calls` the right tools from `available_tools` for this request?"), 0.15, critical=True, label="right tools chosen"),
            Atom("params", _noul("Are all arguments in `agent_tool_calls` correct and grounded in what the user said or earlier tool results?"), 0.2, critical=True, label="arguments correct"),
            Atom("missing", _noul("Did the agent fail to call a tool that was clearly needed to complete the request?"), 0.15, invert=True, label="missed a needed call"),
            Atom("redundant", _noul("Does `agent_tool_calls` contain unnecessary or duplicate calls?"), 0.1, invert=True, label="redundant calls"),
        ],
    },
    "groundedness": {
        "requires": lambda s: bool(s.get("reference_context")) or bool(s.get("tool_results")),
        "atoms": [
            Atom("overall", _score("groundedness",
                 "Judge the factual claims in `agent_final_answer` against the evidence in `reference_context` and `tool_results` only. How grounded is it?"), 0.5, label="overall groundedness"),
            Atom("unsupported", _noul("Does `agent_final_answer` contain a factual claim that is not supported by `reference_context` or `tool_results`?"), 0.3, invert=True, critical=True, label="unsupported claim"),
            Atom("contradicts", _noul("Does `agent_final_answer` contradict anything in `reference_context` or `tool_results`?"), 0.2, invert=True, critical=True, label="contradicts evidence"),
        ],
    },
}

METRICS = list(SPECS)


# --------------------------------------------------------------------------- combine
def combine(metric: str, answers: dict, prefix: str = "", threshold: float = 3) -> dict:
    atoms: list[Atom] = SPECS[metric]["atoms"]
    total_w, acc, confs, checks, cap = 0.0, 0.0, [], [], None
    for a in atoms:
        ans = answers[f"{prefix}{a.key}"]
        if ans["type"] == "score":
            lv = float(ans["score"]) + 1  # 0..4 -> 1..5
            confs.append(float(ans.get("confidence", 0)))
            acc += a.weight * lv
            checks.append({"check": a.label, "type": "score", "value": round(lv, 2),
                           "confidence": ans.get("confidence")})
        else:
            p = float(ans["noul"])
            good = 1 - p if a.invert else p
            confs.append(abs(2 * p - 1))
            acc += a.weight * (1 + 4 * good)
            checks.append({"check": a.label, "type": "noul", "p_yes": round(p, 3), "good": good >= 0.5, "invert": a.invert})
            if a.critical and good < 0.2:
                cap = min(cap or 5, 2.0)
        total_w += a.weight
    score = acc / total_w
    if cap is not None:
        score = min(score, cap)
    score = round(score, 2)
    passed = score >= threshold
    fails = [c["check"] for c in checks if c["type"] == "noul" and not c["good"]]
    reason = (f"score {score}/5 from {len(atoms)} atomic Jev checks; "
              + (f"flagged: {', '.join(fails)}" if fails else "no atomic check flagged")
              + (" (capped by a critical check)" if cap is not None else ""))
    return {
        metric: score,
        f"{metric}_score": score,
        f"{metric}_result": "pass" if passed else "fail",
        f"{metric}_passed": passed,
        f"{metric}_threshold": threshold,
        f"{metric}_reason": reason,
        f"{metric}_confidence": round(sum(confs) / len(confs), 3) if confs else None,
        f"{metric}_status": "completed",
        f"{metric}_properties": {"checks": checks, "judge": "jev"},
    }


def not_applicable(metric: str, why: str, threshold: float = 3) -> dict:
    return {metric: None, f"{metric}_score": None, f"{metric}_result": "not_applicable",
            f"{metric}_passed": None, f"{metric}_threshold": threshold,
            f"{metric}_reason": why, f"{metric}_confidence": None, f"{metric}_status": "skipped",
            f"{metric}_properties": {"judge": "jev"}}


def questions_for(metric: str, prefix: str = "") -> dict:
    return {f"{prefix}{a.key}": a.question for a in SPECS[metric]["atoms"]}


# --------------------------------------------------------------------------- evaluators
class _JevEvaluator:
    """Base: Foundry custom-evaluator contract (callable, keyword inputs, flat dict out)."""
    _RESULT_KEY = ""
    id = ""

    def __init__(self, api_key: str | None = None, *, client: JevClient | None = None,
                 threshold: float = 3, model: str | None = None):
        self._client = client or JevClient(api_key or "", **({"model": model} if model else {}))
        self._threshold = threshold

    def __call__(self, *, query=None, response=None, tool_definitions=None, tool_calls=None,
                 context=None, **kwargs) -> dict:
        state = build_state(query, response, tool_definitions, tool_calls, context)
        m = self._RESULT_KEY
        if not SPECS[m]["requires"](state):
            return not_applicable(m, "required inputs missing for this metric", self._threshold)
        res: JevResult = self._client.ask(state, questions_for(m))
        out = combine(m, res.answers, threshold=self._threshold)
        out[f"{m}_properties"].update(input_tokens=res.input_tokens, latency_ms=round(res.latency_ms, 1),
                                      usd=res.usd, model=res.model)
        return out


class JevIntentResolutionEvaluator(_JevEvaluator):
    _RESULT_KEY = "intent_resolution"


class JevTaskAdherenceEvaluator(_JevEvaluator):
    _RESULT_KEY = "task_adherence"


class JevToolCallAccuracyEvaluator(_JevEvaluator):
    _RESULT_KEY = "tool_call_accuracy"


class JevGroundednessEvaluator(_JevEvaluator):
    _RESULT_KEY = "groundedness"


class JevAgentJudge:
    """All metrics for one row in ONE Jev call (speculative fan-out). Foundry-compatible."""

    def __init__(self, api_key: str | None = None, *, client: JevClient | None = None,
                 metrics: list[str] | None = None, threshold: float = 3, model: str | None = None):
        self._client = client or JevClient(api_key or "", **({"model": model} if model else {}))
        self.metrics = metrics or METRICS
        self._threshold = threshold

    def __call__(self, *, query=None, response=None, tool_definitions=None, tool_calls=None,
                 context=None, **kwargs) -> dict:
        state = build_state(query, response, tool_definitions, tool_calls, context)
        active = [m for m in self.metrics if SPECS[m]["requires"](state)]
        out: dict = {}
        for m in self.metrics:
            if m not in active:
                out.update(not_applicable(m, "required inputs missing for this metric", self._threshold))
        if not active:
            out["jev_properties"] = {"input_tokens": 0, "latency_ms": 0, "usd": 0, "calls": 0}
            return out
        q = {}
        for m in active:
            q.update(questions_for(m, prefix=f"{m}__"))
        res = self._client.ask(state, q)
        for m in active:
            out.update(combine(m, res.answers, prefix=f"{m}__", threshold=self._threshold))
        out["jev_properties"] = {"input_tokens": res.input_tokens, "latency_ms": round(res.latency_ms, 1),
                                 "usd": res.usd, "model": res.model, "calls": 1,
                                 "questions": len(q), "metrics": active}
        return out
