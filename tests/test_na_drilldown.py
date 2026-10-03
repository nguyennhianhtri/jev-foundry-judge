"""t_6a926034: n/a drilldown (run_scope.naCases / resolveNa) uses the same applicability + reason projection."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ST = Path(__file__).resolve().parents[1] / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const L=require(process.argv[1]);const R=require(process.argv[2]);const F=require(process.argv[3]);"
        "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const before=JSON.stringify(a.rows);"
        "const o={applicable:L.applicable,reasonOf:(r,m)=>L.caseLabels(r)[m].reason,formOk:r=>F.editEligibility(r).ok};"
        "const sc=R.runScope(a.rows,a.sel,{all:L.METRICS,applicable:L.applicable});"
        "const na=Object.fromEntries(a.sel.map(m=>[m,R.naCases(a.rows,m,o)]));"
        "const res=a.after?na[a.m].map(e=>R.resolveNa(a.after,e)):null;"
        "process.stdout.write(JSON.stringify({sc,na,res,unchanged:JSON.stringify(a.rows)===before}))})")
TOOL = [{"role": "assistant", "content": [{"type": "tool_call", "name": "t", "arguments": {}}]}, {"role": "tool", "content": "r"}]
ROWS = [
    {"id": "a", "query": "q", "response": "plain"},
    {"id": "b", "query": "q", "response": "x", "context": "ctx"},
    {"id": "dup", "query": "q", "response": "one"},
    {"id": "dup", "query": "q2", "response": "two"},
    {"id": "t", "query": "q", "response": TOOL},
    {"query": "q", "response": [{"role": "assistant", "content": "multi"}, {"role": "assistant", "content": "x"}]},
    {"id": 7, "query": "q", "response": "n"},
]


def run(sel, rows=ROWS, after=None, m=None):
    out = subprocess.run(["node", "-e", CODE, str(ST / "label_coverage.js"), str(ST / "run_scope.js"), str(ST / "case_form.js")],
                         input=json.dumps({"rows": rows, "sel": sel, "after": after, "m": m}), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_counts_equal_drilldown_and_independent_recount():
    r = run(["tool_call_accuracy", "groundedness"])
    assert r["unchanged"]
    for x in r["sc"]["metrics"]:
        assert x["not_applicable"] == len(r["na"][x["metric"]])
    # independent recount by hand
    assert [e["idx"] for e in r["na"]["groundedness"]] == [0, 2, 3, 5, 6]
    assert [e["idx"] for e in r["na"]["tool_call_accuracy"]] == [0, 1, 2, 3, 5, 6]


def test_reasons_ids_dups_and_open_target():
    na = run(["groundedness", "tool_call_accuracy"])["na"]
    g = {e["idx"]: e for e in na["groundedness"]}
    assert g[0]["reason"] == "no context or tool result in this trace" and g[0]["open"] == "form" and g[0]["id"] == "a"
    assert g[2]["dup"] and g[3]["dup"] and not g[0]["dup"]
    assert g[5]["has_id"] is False and g[5]["open"] == "json"          # structured trace -> JSON editor
    assert g[6]["id"] == 7 and g[6]["open"] == "json"                  # non-text id kept exact, form refuses
    assert all(e["open"] == "json" and e["reason"] == "no tool call or tool list in this trace" for e in na["tool_call_accuracy"])


def test_zero_na_metric_has_empty_list():
    assert run(["intent_resolution"])["na"]["intent_resolution"] == []


def test_resolve_same_moved_edited_deleted_ambiguous():
    base = [ROWS[0], ROWS[2], ROWS[3]]
    assert [x["ok"] for x in run(["groundedness"], base, base, "groundedness")["res"]] == [True, True, True]
    moved = [base[2], base[0], base[1]]
    res = run(["groundedness"], base, moved, "groundedness")["res"]
    assert [x["idx"] for x in res] == [1, 2, 0] and all(x.get("moved") for x in res)
    edited = [dict(base[0], context="now"), base[1]]
    res = run(["groundedness"], base, edited, "groundedness")["res"]
    assert res[0]["ok"] is False and "changed or removed" in res[0]["reason"]
    assert res[1]["ok"] and res[1]["idx"] == 1 and res[2]["ok"] is False   # deleted row refused, never another case
    twin = [base[1], base[0], base[0]]
    res = run(["groundedness"], base, twin, "groundedness")["res"]
    assert res[0]["ok"] is False and "ambiguous" in res[0]["reason"]
