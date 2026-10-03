"""Offline tests: contract shape, combination logic, input parsing, mutations, stats."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from jev_foundry_judge.evaluators import (METRICS, SPECS, JevAgentJudge, JevTaskAdherenceEvaluator,
                                          build_state, combine)
from jev_foundry_judge.jev_client import JevClient, JevResult
from jev_foundry_judge.mutations import generate
from jev_foundry_judge.stats import agreement, summarize

ROWS = [json.loads(l) for l in (Path(__file__).resolve().parents[1] / "samples" / "customer_support.jsonl").read_text().splitlines()]


class Stub:
    """Answers every atom 'perfectly good' so the combined score must be 5."""
    model = "stub"

    def __init__(self, good=True):
        self.good, self.calls = good, 0

    def ask(self, state, questions):
        self.calls += 1
        ans = {}
        for k, q in questions.items():
            metric, _, atom = k.rpartition("__")
            atom = atom or k
            spec = next(a for m in METRICS for a in SPECS[m]["atoms"] if a.key == atom and (not metric or m == metric))
            if q["type"] == "score":
                ans[k] = {"type": "score", "score": 4.0 if self.good else 0.0, "confidence": 0.9}
            else:
                yes = self.good != spec.invert
                ans[k] = {"type": "noul", "noul": 0.99 if yes else 0.01}
        return JevResult(ans, "stub", 1000, 0, 5.0)


def test_key_required_and_not_in_repr():
    try:
        JevClient("")
        assert False
    except ValueError:
        pass
    assert "secret" not in repr(JevClient("secret-key-123"))


def test_foundry_output_contract():
    out = JevTaskAdherenceEvaluator(client=Stub())(query=ROWS[0]["query"], response=ROWS[0]["response"],
                                                  tool_definitions=ROWS[0]["tool_definitions"])
    for suf in ("", "_score", "_result", "_passed", "_threshold", "_reason", "_confidence", "_properties"):
        assert f"task_adherence{suf}" in out
    assert out["task_adherence"] >= 4.9 and out["task_adherence_result"] == "pass"


def test_bad_answers_fail_and_cap():
    out = JevAgentJudge(client=Stub(good=False))(query=ROWS[0]["query"], response=ROWS[0]["response"],
                                                tool_definitions=ROWS[0]["tool_definitions"])
    for m in ("intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"):
        assert out[m] <= 2 and out[f"{m}_result"] == "fail", m


def test_one_call_per_row():
    s = Stub()
    JevAgentJudge(client=s)(query=ROWS[0]["query"], response=ROWS[0]["response"], tool_definitions=ROWS[0]["tool_definitions"])
    assert s.calls == 1


def test_not_applicable_groundedness_without_evidence():
    out = JevAgentJudge(client=Stub())(query="hi", response="hello")
    assert out["groundedness_result"] == "not_applicable" and out["tool_call_accuracy_result"] == "not_applicable"


def test_state_extracts_tools_and_system():
    st = build_state(ROWS[0]["query"], ROWS[0]["response"], ROWS[0]["tool_definitions"])
    assert "Northwind" in st["system_instructions"]
    assert [c["name"] for c in st["agent_tool_calls"]] == ["get_order", "issue_refund"]
    assert st["tool_results"] and "refunded" in st["agent_final_answer"]


def test_openai_tool_calls_format():
    resp = [{"role": "assistant", "tool_calls": [{"id": "1", "function": {"name": "get_order", "arguments": "{}"}}]}]
    assert build_state("q", resp)["agent_tool_calls"][0]["name"] == "get_order"


def test_mutations_label_defects():
    g = {r["generated"]: r for r in generate(ROWS[0])}
    assert g["drop_tool_calls"]["human_tool_call_accuracy"] == 1
    assert g["inject_unsupported_claim"]["human_groundedness"] == 1
    assert "~" in g["off_topic_answer"]["id"]


def test_agreement_and_summary():
    a = agreement([(5, 5), (1, 2), (4, 1)])
    assert a["n"] == 3 and abs(a["pass_fail_agreement"] - 2 / 3) < 1e-3
    res = [{"id": "x", "human": {"task_adherence": 5}, "jev": {"task_adherence": 4.5},
            "jev_meta": {"latency_ms": 300, "input_tokens": 1500, "usd": 1500 * 0.042 / 1e6}}]
    s = summarize(res)
    assert s["jev"]["p50_ms"] == 300 and s["jev"]["usd_per_1k_evals"] > 0


def test_combine_weights_sum_positive():
    for m in METRICS:
        assert sum(a.weight for a in SPECS[m]["atoms"]) > 0.99
