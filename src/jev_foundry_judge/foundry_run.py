"""Run a dataset through azure.ai.evaluation.evaluate() and log it to a Foundry project.

Evaluators in one evaluate() call:
  * ``jev``            JevAgentJudge (all metrics, one Jev call per row, visitor's key)
  * ``<metric>``       the Foundry built-in LLM-judge evaluators (host AOAI via managed identity),
                       only when the baseline is requested and configured.
The run, per-row outputs and aggregate metrics are uploaded to ``azure_ai_project`` and the
returned ``studio_url`` opens the run in the Foundry portal.
"""
from __future__ import annotations

import json
import math
import os
import tempfile

from . import baseline
from .evaluators import METRICS, JevAgentJudge
from .jev_client import JevClient

INPUT_COLS = ("id", "query", "response", "tool_definitions", "tool_calls", "context")


def project_endpoint() -> str:
    return os.getenv("FOUNDRY_PROJECT_ENDPOINT", "")


def portal_project_url() -> str:
    return os.getenv("FOUNDRY_PORTAL_URL", "")


class _BuiltIn:
    """Thin callable around the real azure-ai-evaluation built-in evaluator for one metric."""

    def __init__(self, metric: str):
        self.metric = metric

    def __call__(self, *, query=None, response=None, tool_definitions=None, context=None):
        r = baseline.run_metric(self.metric, {"query": query, "response": response,
                                              "tool_definitions": tool_definitions, "context": context})
        return {self.metric: r.get("score"), f"{self.metric}_result": r.get("result"),
                "latency_ms": r.get("latency_ms"), "usd": r.get("usd")}


def _credential():
    from azure.identity import DefaultAzureCredential
    return DefaultAzureCredential(managed_identity_client_id=os.getenv("AZURE_CLIENT_ID") or None)


def run(rows: list[dict], key: str, metrics: list[str], with_baseline: bool, name: str | None = None) -> dict:
    from azure.ai.evaluation import evaluate
    ep = project_endpoint()
    if not ep:
        raise RuntimeError("FOUNDRY_PROJECT_ENDPOINT not configured")
    evaluators: dict = {"jev": JevAgentJudge(client=JevClient(key), metrics=metrics)}
    if with_baseline:
        for m in metrics:
            evaluators[m] = _BuiltIn(m)
    mapping = {c: "${data.%s}" % c for c in INPUT_COLS if c != "id"}
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "dataset.jsonl")
        with open(p, "w") as f:
            for i, r in enumerate(rows):  # row_index binds each output to its exact source row
                f.write(json.dumps({**{c: r.get(c) for c in INPUT_COLS}, "row_index": i}) + "\n")
        res = evaluate(data=p, evaluators=evaluators, azure_ai_project=ep, credential=_credential(),
                       evaluation_name=name or "jev-foundry-judge",
                       evaluator_config={"default": {"column_mapping": mapping}},
                       tags={"app": "jev-foundry-judge", "judges": ",".join(evaluators)},
                       fail_on_evaluator_errors=False)
    return {"studio_url": res.get("studio_url"), "metrics": _clean(res.get("metrics")), "rows": res.get("rows") or []}


def _clean(v):
    """evaluate() rows come from pandas: turn NaN/inf into None so the response is valid JSON."""
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


def to_app_results(out_rows: list[dict], src_rows: list[dict], metrics: list[str]) -> list[dict]:
    """Map evaluate() rows back to the dashboard's row shape (same as /api/judge).

    Output i always corresponds to src_rows[i] (bound by the ``row_index`` column we write, never by
    id, so duplicate ids stay distinct); a source row with no evaluate() output is returned as an error.
    """
    out_rows = [_clean(o) for o in out_rows]
    by_pos: dict[int, dict] = {}
    for i, o in enumerate(out_rows):
        ri = o.get("inputs.row_index")
        by_pos[int(ri) if isinstance(ri, (int, float)) else i] = o
    res = []
    for i, src in enumerate(src_rows):
        o = by_pos.get(i)
        x = {"id": src.get("id"), "human": {m: src.get(f"human_{m}") for m in METRICS}}
        if o is None:
            x["error"] = "No evaluate() output for this row"
            res.append(x)
            continue
        J = lambda k: o.get(f"outputs.jev.{k}")
        if J("jev_properties") is None and all(J(m) is None for m in metrics):
            x["error"] = "Jev evaluator failed on this row"
        else:
            x["jev"] = {m: J(m) for m in metrics}
            x["jev_detail"] = {m: {"result": J(f"{m}_result"), "confidence": J(f"{m}_confidence"),
                                   "reason": J(f"{m}_reason"),
                                   "checks": (J(f"{m}_properties") or {}).get("checks")} for m in metrics}
            x["jev_meta"] = J("jev_properties")
        if any(f"outputs.{m}.{m}" in o for m in metrics):
            x["llm"] = {m: {"score": o.get(f"outputs.{m}.{m}"), "result": o.get(f"outputs.{m}.{m}_result"),
                            "latency_ms": o.get(f"outputs.{m}.latency_ms"), "usd": o.get(f"outputs.{m}.usd")}
                        for m in metrics}
        res.append(x)
    return res
