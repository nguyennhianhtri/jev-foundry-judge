"""Jev Choice as a model router. The model cards become Choice criteria; Jev returns a calibrated
probability per model. Policy (confidence fallback / cheapest-above-p) is applied in code."""
from __future__ import annotations

import math
import os
import time

from .jev_client import JEV_USD_PER_MTOK_INPUT, JevClient

INSTRUCTIONS = ("Route this user prompt to exactly one model. Pick the cheapest model whose described capabilities "
                "are enough to answer it well; pick a stronger or specialised model only when the prompt needs it.")

# Azure retail list prices, Global Standard, USD per 1M tokens (prices.azure.com, read 2026-09-29).
DEFAULT_MODELS = [
    {"key": "small", "name": "gpt-5.4-nano", "deployment": "router-gpt-5-4-nano", "in": 0.20, "out": 1.25,
     "desc": "Small, fast, cheap. Good for greetings and chit-chat, simple factual lookups, short rewrites, "
             "summaries, translation and classification. Weak at multi-step reasoning and non-trivial code."},
    {"key": "strong", "name": "gpt-5.4", "deployment": "router-gpt-5-4", "in": 2.50, "out": 15.00,
     "desc": "Strongest general reasoning model. Use for multi-step maths and word problems, logic puzzles, "
             "expert-level science/law/medicine questions, careful analysis and planning."},
    {"key": "code", "name": "gpt-5.3-codex", "deployment": "router-gpt-5-3-codex", "in": 1.75, "out": 14.00,
     "desc": "Code specialist. Use when the prompt asks to write, complete, fix, refactor, test or explain "
             "source code or a programming function."},
]


def _crit(models: list[dict]) -> dict:
    return {m["key"]: f'{m["name"]}: {m["desc"]}' for m in models}


def route(client: JevClient, prompt: str, models: list[dict]) -> dict:
    r = client.ask({"user_prompt": prompt}, {"route": {"type": "choice", "instructions": INSTRUCTIONS,
                                                       "criteria": _crit(models)}})
    a = r.answers["route"]
    probs = {m["key"]: float(a.get("probabilities", {}).get(m["key"], 0.0)) for m in models}
    return {"choice": a.get("choice"), "probabilities": probs, "confidence": float(a.get("confidence", 0.0)),
            "latency_ms": round(r.latency_ms, 1), "input_tokens": r.input_tokens,
            "usd": r.input_tokens * JEV_USD_PER_MTOK_INPUT / 1e6, "model": r.model}


def answer_cost(m: dict | None, tin, tout) -> float | None:
    """The one answer-cost formula (USD per call); mirrors answerCost in app/static/router.js.
    Unknown/invalid price or token count -> None (unavailable, never free). Both tokens 0 -> 0 for all (a tie)."""
    ok = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0
    if not m or not all(ok(v) for v in (m.get("in"), m.get("out"), tin, tout)):
        return None
    return (tin * m["in"] + tout * m["out"]) / 1e6


def apply_policy(probs: dict, confidence: float, models: list[dict], strong_key: str,
                 conf_threshold: float, cheapest_p: float | None, tin=None, tout=None) -> dict:
    """1) lowest answer_cost(tin, tout) model with p >= cheapest_p (if set; unknown cost never wins, ties keep
    model-list order); else argmax. 2) confidence < threshold -> strong."""
    argmax = max(probs, key=probs.get)
    pick, why = argmax, "highest probability"
    if cheapest_p is not None:
        ok = [m for m in models if probs.get(m["key"], 0) >= cheapest_p]
        if ok:
            def cost(m):
                c = answer_cost(m, tin, tout)
                return float("inf") if c is None else c
            c = min(ok, key=cost)  # min keeps the first on ties, like the browser reduce
            pick, why = c["key"], f"cheapest model with p ≥ {cheapest_p:g}"
        else:
            pick, why = strong_key, f"no model reached p ≥ {cheapest_p:g}; fell back to strong"
    if confidence < conf_threshold and pick != strong_key:
        pick, why = strong_key, f"confidence {confidence:.2f} < {conf_threshold:g}; fell back to strong"
    return {"routed": pick, "why": why, "argmax": argmax}


# ---------- optional execution on TEAM Azure OpenAI (host-paid, capped)
def aoai_token() -> str:
    from azure.identity import DefaultAzureCredential
    global _CRED
    try:
        _CRED
    except NameError:
        _CRED = DefaultAzureCredential(managed_identity_client_id=os.getenv("AZURE_CLIENT_ID") or None)
    return _CRED.get_token("https://cognitiveservices.azure.com/.default").token


def execute(deployment: str, prompt: str, max_tokens: int = 600) -> dict:
    import json
    import urllib.request
    ep = os.environ["AOAI_ENDPOINT"].rstrip("/")
    body = {"messages": [{"role": "user", "content": prompt}], "max_completion_tokens": max_tokens}
    req = urllib.request.Request(f"{ep}/openai/deployments/{deployment}/chat/completions?api-version=2025-04-01-preview",
                                 json.dumps(body).encode(), {"Authorization": "Bearer " + aoai_token(),
                                                             "Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=90) as r:
        o = json.load(r)
    ms = (time.perf_counter() - t0) * 1000
    u = o.get("usage", {})
    return {"text": (o["choices"][0]["message"].get("content") or ""), "latency_ms": round(ms, 1),
            "prompt_tokens": u.get("prompt_tokens", 0), "completion_tokens": u.get("completion_tokens", 0),
            "finish_reason": o["choices"][0].get("finish_reason")}
