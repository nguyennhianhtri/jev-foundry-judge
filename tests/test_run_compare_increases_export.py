"""t_332de501: the Recorded score increases view exported as a .jsonl evaluation dataset of the CURRENT frozen run rows.
Same composition as the decreases export: runCompareChanges(..., "inc") membership/order -> {pos, id} -> buildCaseListExport
(evaluated-dataset serializer). SYNTHETIC fixtures; stored scores are fixture values, not live judge output."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const E=require(process.argv[1]),X=require(process.argv[2]),RC=require(process.argv[3]);let d='';"
        "process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const b0=JSON.stringify(a);"
        "const r=RC.buildRunCompare(a.base,a.cur);const D=RC.runCompareChanges(r,a.j,a.m,a.dir);"
        "const L=D.ok?D.shown.map(x=>({pos:x.current_pos,id:x.id})):[];"
        "const o=X.buildCaseListExport({runRows:a.cur.rows,results:a.cur.results,summary:a.sum,key:a.key,list:a.list||L,build:E.buildEvaluatedDataset});"
        "o.D=D;o.unchanged=JSON.stringify(a)===b0;process.stdout.write(JSON.stringify(o))})")


def run(**a):
    out = subprocess.run(["node", "-e", CODE, str(ST / "evaluated_dataset.js"), str(ST / "case_list_export.js"), str(ST / "run_compare.js")],
                         input=json.dumps(a), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


IR = "intent_resolution"
line = lambda r: json.dumps(r, separators=(",", ":"), ensure_ascii=False)
BROWS = [{"id": 7, "query": "q", "response": "r", "zz_unknown": {"n": None, "a": [1, None]}}, {"id": "7", "query": "q2", "response": "r2", "source": "user-authored"},
         {"id": "ctx", "query": "q3", "response": "old"}, {"id": "dn", "query": "q4", "response": "r4"},
         {"id": "eq", "query": "q5", "response": "r5"}, {"id": "miss", "query": "q6", "response": "r6"}]
BRES = [{"id": 7, "jev": {IR: 2}}, {"id": "7", "jev": {IR: 1}}, {"id": "ctx", "jev": {IR: 1}}, {"id": "dn", "jev": {IR: 5}},
        {"id": "eq", "jev": {IR: 3}}, {"id": "miss", "jev": {IR: 1}}]
CROWS = [{"id": "dn", "query": "q4", "response": "r4"},
         {"id": 7, "query": "q", "response": "r", "human_intent_resolution": None, "zz_unknown": {"n": None, "a": [1, None]}},
         {"id": "ctx", "query": "q3", "response": "new"},
         {"id": "7", "query": "q2", "response": "r2", "human_intent_resolution": 4, "source": "user-authored"},
         {"id": "eq", "query": "q5", "response": "r5"}, {"id": "miss", "query": "q6", "response": "r6"}]
CRES = [{"id": "dn", "jev": {IR: 1}}, {"id": 7, "jev": {IR: 3}}, {"id": "ctx", "jev": {IR: 5}}, {"id": "7", "jev": {IR: 5}},
        {"id": "eq", "jev": {IR: 3}}, {"id": "miss", "jev": {}}]
SUM = {"version": "vCur", "at": "2026-09-29T00:00:00Z"}
base = {"rows": BROWS, "results": BRES, "version": "vBase", "at": "t0"}
cur = {"rows": CROWS, "results": CRES, "version": "vCur", "at": "t1", "complete": True}


def test_increases_export_exact_shown_current_rows_in_shown_order():
    o = run(base=base, cur=cur, sum=SUM, j="jev", m=IR, dir="inc")
    D = o["D"]
    # "7" +4 before 7 +1 (largest first); 7 != "7"; dn (lower), eq (0 = unchanged), ctx (changed), miss (no score) never shown
    assert [x["id"] for x in D["shown"]] == ["7", 7] and D["eligible"] == 4 and D["unchanged"] == 1 and D["opposite"] == 1
    assert D["excluded"] == {"changed": 1, "cannot_compare": 0, "missing": 1}
    assert o["ok"] and o["n"] == 2 and o["positions"] == [3, 1] and o["ids"] == ["7", 7]
    assert o["text"] == line(CROWS[3]) + "\n" + line(CROWS[1]) + "\n"   # CURRENT traces, not baseline
    rows = [json.loads(x) for x in o["text"].splitlines()]
    assert rows[1]["zz_unknown"] == {"n": None, "a": [1, None]} and rows[1]["human_intent_resolution"] is None
    assert rows[0]["human_intent_resolution"] == 4 and "jev" not in o["text"]
    assert all(k not in o["text"] for k in ('"dn"', '"eq"', '"ctx"', '"miss"'))
    assert o["unchanged"]


def test_decreases_unchanged_by_direction_and_disjoint():
    o = run(base=base, cur=cur, sum=SUM, j="jev", m=IR, dir="dec")
    assert [x["id"] for x in o["D"]["shown"]] == ["dn"] and o["text"] == line(CROWS[0]) + "\n"


def test_no_increase_no_file_and_stale_binding_refuses():
    cur2 = {**cur, "results": [{**r, "jev": {IR: 1}} for r in CRES]}
    o = run(base=base, cur=cur2, sum=SUM, j="jev", m=IR, dir="inc")
    assert o["D"]["shown"] == [] and not o["ok"] and o["reason"] == "empty"
    # a list bound to text "7" at the position now holding number 7 is refused, never substituted
    o = run(base=base, cur=cur, sum=SUM, j="jev", m=IR, dir="inc", list=[{"pos": 1, "id": "7"}])
    assert not o["ok"] and o["reason"] == "stale"
