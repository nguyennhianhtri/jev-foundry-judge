"""Per-metric label coverage (app/static/label_coverage.js): applicability is bound to the REAL Python judge rule
(build_state + SPECS[m].requires) row by row, and counts are bound to an independent Python recomputation over
mixed / no-tool / blank / label-0 / invalid / partial / rich-trace cases plus every shipped sample."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from jev_foundry_judge.evaluators import SPECS, build_state  # noqa: E402

JS = ROOT / "app" / "static" / "label_coverage.js"
M4 = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")

RICH = [{"role": "assistant", "content": [{"type": "tool_call", "tool_call_id": "c1", "name": "lookup", "arguments": {"x": 1}}]},
        {"role": "tool", "tool_call_id": "c1", "content": [{"type": "tool_result", "tool_result": {"ok": True}}]},
        {"role": "assistant", "content": [{"type": "text", "text": "done"}]}]
CASES = [
    {"id": "plain", "query": "hi", "response": "hello", "human_intent_resolution": 5},                       # no tools, no ctx
    {"id": "ctx", "query": "q", "response": "a", "context": "doc", "human_groundedness": 4, "human_tool_call_accuracy": 3},
    {"id": "rich", "query": [{"role": "user", "content": "q"}], "response": RICH, "human_tool_call_accuracy": 2,
     "human_groundedness": 5, "human_task_adherence": 4, "source": "user-authored"},
    {"id": "defs-only", "query": "q", "response": "a", "tool_definitions": [{"name": "t"}], "generated": True, "human_tool_call_accuracy": 1},
    {"id": "empty-defs", "query": "q", "response": "a", "tool_definitions": [], "context": ""},
    {"id": "oai-calls", "query": "q", "response": [{"role": "assistant", "tool_calls": [{"function": {"name": "f", "arguments": "{}"}}]}]},
    {"id": "flat-calls", "query": "q", "response": "a", "tool_calls": [{"name": "f", "arguments": {}}]},
    {"id": "tool-str", "query": "q", "response": [{"role": "tool", "content": "raw"}, {"role": "assistant", "content": "a"}]},
    {"id": "label0", "query": "q", "response": "a", "human_intent_resolution": 0, "human_task_adherence": 3.5},
    {"id": "labelstr", "query": "q", "response": "a", "human_intent_resolution": "4", "human_task_adherence": None},
    {"id": "big", "query": "q", "response": "a", "human_task_adherence": 6, "human_intent_resolution": True},
    {"query": "no id", "response": "a", "human_task_adherence": 2},
]


def js(fn, arg):
    code = (f"const L=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{{"
            f"const a=JSON.parse(d);process.stdout.write(JSON.stringify({fn}))}})")
    out = subprocess.run(["node", "-e", code, str(JS)], input=json.dumps(arg), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def py_applicable(r, m):
    return bool(SPECS[m]["requires"](build_state(r.get("query"), r.get("response"), r.get("tool_definitions"),
                                                  r.get("tool_calls"), r.get("context"))))


def py_valid(v):
    return isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 5


def samples():
    rows = []
    for f in sorted((ROOT / "samples").glob("*.jsonl")):
        rows += [json.loads(line) for line in f.read_text().splitlines() if line.strip()]
    return rows


def test_applicability_matches_python_judge():
    rows = CASES + samples()
    got = js("a.map(r=>L.METRICS.map(m=>L.applicable(r,m)))", rows)
    for r, g in zip(rows, got):
        assert g == [py_applicable(r, m) for m in M4], r.get("id")


def test_counts_bound_to_independent_recomputation():
    for rows in (CASES, samples(), CASES + samples()):
        cov = js("L.buildCoverage(a)", rows)
        assert cov["rows"] == len(rows)
        for m in M4:
            x, ap = cov["metrics"][m], [py_applicable(r, m) for r in rows]
            lab = [r.get(f"human_{m}") for r in rows]
            assert x["applicable"] == sum(ap) and x["not_applicable"] == len(rows) - sum(ap)
            assert x["comparable"] == sum(a and py_valid(v) for a, v in zip(ap, lab))
            assert [e["idx"] for e in x["missing"]] == [i for i, (a, v) in enumerate(zip(ap, lab)) if a and v in (None, "")]
            assert [e["idx"] for e in x["invalid"]] == [i for i, (a, v) in enumerate(zip(ap, lab)) if a and v not in (None, "") and not py_valid(v)]
            assert x["comparable"] + len(x["missing"]) + len(x["invalid"]) == x["applicable"]
            assert sum(x["by_provenance"].values()) == x["comparable"]


def test_specific_cases():
    cov = js("L.buildCoverage(a)", CASES)["metrics"]
    tc = cov["tool_call_accuracy"]
    # applicable: rich, defs-only, oai-calls, flat-calls (empty tool_definitions [] is falsy, as in Python)
    assert tc["applicable"] == 4 and tc["comparable"] == 2          # rich 2, defs-only 1
    assert [e["id"] for e in tc["label_on_not_applicable"]] == ["ctx"]  # label kept but judge will not score it
    assert tc["by_provenance"] == {"user-authored": 1, "generated": 1, "not recorded": 0}
    assert {e["id"] for e in cov["intent_resolution"]["invalid"]} == {"label0", "labelstr", "big"}
    assert [e["id"] for e in cov["task_adherence"]["invalid"]] == ["label0", "big"]
    assert cov["task_adherence"]["missing"][-1] != {"idx": 11, "id": None}   # the id-less row is labelled 2
    assert {"idx": 11, "id": None} in cov["intent_resolution"]["missing"]
    assert cov["groundedness"]["applicable"] == 3                 # ctx, rich (tool result), tool-str


def test_pure_no_mutation_and_empty():
    rows = json.loads(json.dumps(CASES))
    out = js("(()=>{const b=JSON.stringify(a);L.buildCoverage(a);return JSON.stringify(a)===b})()", rows)
    assert out is True
    e = js("L.buildCoverage(a)", [])
    assert e["rows"] == 0 and all(e["metrics"][m]["applicable"] == 0 for m in M4)
