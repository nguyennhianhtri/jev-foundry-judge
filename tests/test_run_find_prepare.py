"""t_d1c0abe0: prepare exactly the cases shown by "Search this run" for another run (run_find_export.prepareRunFind).
Members = the SAME plan.include as the searched download (shown order, position + typed id) through the SAME
slow_prepare.prepareRerun binding. SYNTHETIC fixtures (labelled tests only)."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const P=require(process.argv[1]),F=require(process.argv[2]),R=require(process.argv[3]);let d='';"
        "process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);a.selected=new Set(a.selected||[]);const b=JSON.stringify({...a,selected:[...a.selected]});"
        "if(a.q!==undefined){const rf=F.findRunCases(a.results,a.runRows,a.q,r=>({req:String(r.query??''),ans:String(r.response??'')}));"
        "const vis=a.order?a.order.filter(p=>rf.shown.includes(p)):rf.shown;"
        "a.list=F.runMatchList(a.results,vis,(p,id)=>!!a.runRows[p]&&a.runRows[p].id===id);}"
        "const o=R.prepareRunFind({...a,prepare:P.prepareRerun});"
        "o._inputSame=JSON.stringify({...a,selected:[...a.selected],list:undefined,q:undefined,order:undefined})===JSON.stringify({...JSON.parse(b),list:undefined,q:undefined,order:undefined});"
        "process.stdout.write(JSON.stringify(o))})")


def run(**a):
    out = subprocess.run(["node", "-e", CODE, *(str(ST / f) for f in ("slow_prepare.js", "case_find.js", "run_find_export.js"))],
                         input=json.dumps(a), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


ROWS = [{"id": 7, "query": "refund please", "response": "ok"},
        {"id": "7", "query": "refund later", "response": "ok2"},
        {"query": "refund no id", "response": "r3"},
        {"id": "sup-01", "query": "refund dup A", "response": "r4"},
        {"id": "sup-01", "query": "refund dup B", "response": "r5"},
        {"id": "zz", "query": "other", "response": "r6"}]
RES = [{"id": 7}, {"id": "7"}, {}, {"id": "sup-01"}, {"id": "sup-01"}, {"id": "zz"}]
SUM = {"version": "vT"}
POS = list(range(6))


def test_shown_search_order_maps_to_exact_dataset_rows_typed_dup_absent():
    o = run(runRows=ROWS, results=RES, summary=SUM, runPos=POS, rows=ROWS, selected=[5], q="refund", order=[4, 0, 2, 1, 3, 5])
    assert o["ok"] and [m["pos"] for m in o["mapped"]] == [4, 0, 2, 1, 3]
    assert o["after"]["positions"] == [0, 1, 2, 3, 4] and o["after"]["n"] == 5
    assert o["before"]["positions"] == [5] and o["added"] == 5 and o["removed"] == 1 and o["unchanged"] == 0
    assert o["plan"]["shown"] == 5 and o["plan"]["excluded"] == []


def test_numeric_vs_string_seven_kept_apart():
    o = run(runRows=ROWS, results=RES, summary=SUM, runPos=POS, rows=ROWS, q="7")
    assert o["ok"] and o["after"]["ids"] == [7, "7"] and o["after"]["positions"] == [0, 1]


def test_unbound_excluded_never_substituted_and_none_bound_refuses():
    rows = [dict(ROWS[0]), {"id": 7, "query": "refund ghost", "response": "x"}] + ROWS[2:]
    L = [{"pos": 0, "id": 7}, {"pos": 1, "id": "7", "open": False}]
    o = run(runRows=rows, results=RES, summary=SUM, runPos=POS, rows=rows, list=L)
    assert o["ok"] and o["after"]["positions"] == [0] and o["plan"]["excluded"] == [{"pos": 1, "id": "7"}]
    n = run(runRows=rows, results=RES, summary=SUM, runPos=POS, rows=rows, selected=[3], list=[L[1]])
    assert not n["ok"] and n["reason"] == "none_bound" and n["before"]["positions"] == [3] and "after" not in n


def test_edited_missing_ambiguous_refuse_whole_with_reasons():
    ed = [dict(ROWS[0], response="EDITED")] + ROWS[1:]
    o = run(runRows=ROWS, results=RES, summary=SUM, runPos=POS, rows=ed, selected=[5], list=[{"pos": 0, "id": 7}, {"pos": 1, "id": "7"}])
    assert not o["ok"] and o["reason"] == "unmappable" and "changed" in o["problems"][0]["why"] and o["before"]["positions"] == [5]
    gone = run(runRows=ROWS, results=RES, summary=SUM, runPos=None, rows=ROWS[1:], list=[{"pos": 0, "id": 7}])
    assert not gone["ok"] and "no longer in the dataset" in gone["problems"][0]["why"]
    amb = run(runRows=ROWS, results=RES, summary=SUM, runPos=None, rows=ROWS + [dict(ROWS[0])], list=[{"pos": 0, "id": 7}])
    assert not amb["ok"] and "ambiguous" in amb["problems"][0]["why"]


def test_empty_partial_nodataset_refuse_and_input_unchanged():
    assert run(runRows=ROWS, results=RES, summary=SUM, rows=ROWS, q="zzqq-none")["reason"] == "empty"
    assert run(runRows=ROWS, results=RES[:3], summary=None, rows=ROWS, list=[{"pos": 0, "id": 7}])["reason"] == "partial"
    assert run(runRows=ROWS, results=RES, summary=None, rows=ROWS, list=[{"pos": 0, "id": 7}])["reason"] == "partial"
    assert run(runRows=ROWS, results=RES, summary=SUM, rows=[], list=[{"pos": 0, "id": 7}])["reason"] == "no_dataset"
    assert run(runRows=ROWS, results=RES, summary=SUM, runPos=POS, rows=ROWS, selected=[2], list=[{"pos": 3, "id": "sup-01"}])["_inputSame"]
