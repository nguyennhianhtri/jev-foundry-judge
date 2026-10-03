"""Baseline: the Foundry built-in LLM-judge evaluators (azure-ai-evaluation) on an
Azure OpenAI deployment, called with Entra (managed identity / CLI) credentials.

Optional. Enabled when AOAI_ENDPOINT and AOAI_DEPLOYMENT are set server-side.
Prices are the Azure retail list prices for the configured model, set via env.
"""
from __future__ import annotations

import os
import time

_EVALS: dict | None = None


def configured() -> bool:
    return bool(os.getenv("AOAI_ENDPOINT") and os.getenv("AOAI_DEPLOYMENT"))


def info() -> dict:
    return {"enabled": configured(), "deployment": os.getenv("AOAI_DEPLOYMENT", ""),
            "model": os.getenv("AOAI_MODEL_LABEL", os.getenv("AOAI_DEPLOYMENT", "")),
            "usd_per_mtok_in": float(os.getenv("AOAI_USD_PER_MTOK_IN", "0.75")),
            "usd_per_mtok_out": float(os.getenv("AOAI_USD_PER_MTOK_OUT", "4.5"))}


def _evaluators() -> dict:
    global _EVALS
    if _EVALS is None:
        from azure.ai.evaluation import (GroundednessEvaluator, IntentResolutionEvaluator,
                                         TaskAdherenceEvaluator, ToolCallAccuracyEvaluator)
        from azure.identity import DefaultAzureCredential
        cred = DefaultAzureCredential(managed_identity_client_id=os.getenv("AZURE_CLIENT_ID") or None)
        cfg = {"azure_endpoint": os.environ["AOAI_ENDPOINT"], "azure_deployment": os.environ["AOAI_DEPLOYMENT"],
               "api_version": os.getenv("AOAI_API_VERSION", "2025-04-01-preview")}
        kw = {"credential": cred, "is_reasoning_model": os.getenv("AOAI_REASONING", "1") == "1"}
        _EVALS = {
            "intent_resolution": IntentResolutionEvaluator(cfg, **kw),
            "task_adherence": TaskAdherenceEvaluator(cfg, **kw),
            "tool_call_accuracy": ToolCallAccuracyEvaluator(cfg, **kw),
            "groundedness": GroundednessEvaluator(cfg, **kw),
        }
    return _EVALS


def _tool_results_text(response) -> str:
    out = []
    if isinstance(response, list):
        for m in response:
            if isinstance(m, dict) and m.get("role") == "tool":
                out.append(str(m.get("content")))
    return "\n".join(out)


def _final(response) -> str:
    from .evaluators import _final_answer
    return _final_answer(response)


def run_metric(metric: str, row: dict) -> dict:
    """Returns {score(1-5 or None), result, latency_ms, prompt_tokens, completion_tokens, usd}."""
    ev = _evaluators()[metric]
    q, r, tools = row.get("query"), row.get("response"), row.get("tool_definitions")
    t0 = time.perf_counter()
    if metric == "tool_call_accuracy":
        if not tools:
            return {"score": None, "result": "not_applicable"}
        out = ev(query=q, response=r, tool_definitions=tools)
    elif metric == "groundedness":
        ctx = row.get("context") or _tool_results_text(r)
        if not ctx:
            return {"score": None, "result": "not_applicable"}
        qtext = q if isinstance(q, str) else " ".join(str(m.get("content")) for m in q if m.get("role") == "user")
        out = ev(query=qtext, response=_final(r), context=ctx if isinstance(ctx, str) else str(ctx))
    else:
        kw = {"query": q, "response": r}
        if tools:
            kw["tool_definitions"] = tools
        out = ev(**kw)
    ms = (time.perf_counter() - t0) * 1000
    props = out.get(f"{metric}_properties") or {}
    pt = int(props.get("prompt_tokens") or out.get(f"{metric}_prompt_tokens") or 0)
    ct = int(props.get("completion_tokens") or out.get(f"{metric}_completion_tokens") or 0)
    score = out.get(metric)
    try:
        score = float(score) if score is not None else None
    except (TypeError, ValueError):
        score = None
    # Task adherence is binary 0/1 in current SDK: map to 1-5 scale (fail=1, pass=5)
    if metric == "task_adherence" and score is not None and score <= 1:
        score = 5.0 if score >= 1 else 1.0
    p = info()
    usd = pt * p["usd_per_mtok_in"] / 1e6 + ct * p["usd_per_mtok_out"] / 1e6
    return {"score": score, "result": out.get(f"{metric}_result"), "latency_ms": round(ms, 1),
            "prompt_tokens": pt, "completion_tokens": ct, "usd": usd}
