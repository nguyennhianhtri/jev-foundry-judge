"""t_ba9f4888: the Recorded score decreases view exported as a .jsonl evaluation dataset of the CURRENT frozen run rows.
Composition only: runCompareDecreases membership/order -> {pos: current_pos, id} -> buildCaseListExport (evaluated-dataset
serializer). SYNTHETIC fixtures; stored scores are fixture values, not live judge output."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const E=require(process.argv[1]),X=require(process.argv[2]),RC=require(process.argv[3]);let d='';"
        "process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const b0=JSON.stringify(a);"
        "const r=RC.buildRunCompare(a.base,a.cur);const D=RC.runCompareDecreases(r,a.j,a.m);"
        "const L=D.ok?D.shown.map(x=>({pos:x.current_pos,id:x.id})):[];"
        "const o=X.buildCaseListExport({runRows:a.cur.rows,results:a.cur.results,summary:a.sum,key:a.key,list:L,build:E.buildEvaluatedDataset});"
        "o.D=D;o.unchanged=JSON.stringify(a)===b0;process.stdout.write(JSON.stringify(o))})")


def run(**a):
    out = subprocess.run(["node", "-e", CODE, str(ST / "evaluated_dataset.js"), str(ST / "case_list_export.js"), str(ST / "run_compare.js")],
                         input=json.dumps(a), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


IR = "intent_resolution"
line = lambda r: json.dumps(r, separators=(",", ":"), ensure_ascii=False)
BROWS = [{"id": 7, "query": "q", "response": "r"}, {"id": "7", "query": "q2", "response": "r2", "source": "user-authored", "x": {"k": None}, "human_intent_resolution": 1},
         {"id": "ctx", "query": "q3", "response": "old"}, {"id": "up", "query": "q4", "response": "r4"},
         {"id": "dup", "query": "d", "response": "d"}]
BRES = [{"id": 7, "jev": {IR: 4}}, {"id": "7", "jev": {IR: 5}}, {"id": "ctx", "jev": {IR: 5}}, {"id": "up", "jev": {IR: 2}}, {"id": "dup", "jev": {IR: 5}}]
# current rows in a DIFFERENT order, with authored human labels + provenance and unknown fields that must survive
CROWS = [{"id": "up", "query": "q4", "response": "r4"},
         {"id": "7", "query": "q2", "response": "r2", "human_intent_resolution": 5, "source": "user-authored", "x": {"k": None}},
         {"id": "ctx", "query": "q3", "response": "new"},
         {"id": 7, "query": "q", "response": "r", "human_intent_resolution": 2},
         {"id": "dup", "query": "d", "response": "d"}, {"id": "dup", "query": "d", "response": "d"}]
CRES = [{"id": "up", "jev": {IR: 3}}, {"id": "7", "jev": {IR: 3}}, {"id": "ctx", "jev": {IR: 1}}, {"id": 7, "jev": {IR: 3}},
        {"id": "dup", "jev": {IR: 1}}, {"id": "dup", "jev": {IR: 1}}]
SUM = {"version": "vCur", "at": "2026-09-28T00:00:00Z"}
base = {"rows": BROWS, "results": BRES, "version": "vBase", "at": "t0"}
cur = {"rows": CROWS, "results": CRES, "version": "vCur", "at": "t1", "complete": True}


def test_exports_exactly_shown_current_rows_in_shown_order_byte_exact():
    o = run(base=base, cur=cur, sum=SUM, j="jev", m=IR)
    D = o["D"]
    assert [x["id"] for x in D["shown"]] == ["7", 7] and D["eligible"] == 3 and D["excluded"]["changed"] == 1 and D["not_matched"] == 1
    assert o["ok"] and o["n"] == 2 and o["total"] == 6 and o["positions"] == [1, 3]
    assert o["text"] == line(CROWS[1]) + "\n" + line(CROWS[3]) + "\n"  # current traces, not baseline; labels as authored
    assert "jev" not in o["text"] and "ctx" not in o["text"] and "dup" not in o["text"] and "up" not in o["text"]
    assert [json.loads(x)["human_intent_resolution"] for x in o["text"].splitlines()] == [5, 2]  # never judge scores
    assert o["unchanged"]


def test_no_decrease_is_empty_and_nothing_exported():
    cur2 = {**cur, "results": [{**r, "jev": {IR: 5}} for r in CRES]}
    o = run(base=base, cur=cur2, sum=SUM, j="jev", m=IR)
    assert o["D"]["shown"] == [] and o == {**o, "ok": False, "reason": "empty"} and "text" not in o


def test_incomplete_current_run_or_key_in_rows_refuses():
    o = run(base=base, cur=cur, sum=None, j="jev", m=IR)
    assert not o["D"]["ok"] or not o["ok"]
    o = run(base=base, cur=cur, sum=SUM, j="jev", m=IR, key="q2-secret-key")
    assert o["ok"]  # key text absent -> allowed
    rows = [dict(r) for r in CROWS]; rows[1]["query"] = "q2-secret-key"; brows = [dict(r) for r in BROWS]; brows[1]["query"] = "q2-secret-key"
    o = run(base={**base, "rows": brows}, cur={**cur, "rows": rows}, sum=SUM, j="jev", m=IR, key="q2-secret-key")
    assert o == {**o, "ok": False, "reason": "key_in_rows"}
