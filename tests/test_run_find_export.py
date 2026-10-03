"""t_aaeefd58: download exactly the cases shown by "Search this run" (run_find_export.js) as a focused .jsonl dataset.
Bytes = evaluated-dataset serializer lines for exactly the shown, bound frozen rows in SHOWN order (position + typed id);
unbound matches are excluded and counted, never substituted; empty/partial/stale refuse. SYNTHETIC fixtures + the
retained REAL run of t_80f908ea."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const E=require(process.argv[1]),X=require(process.argv[2]),F=require(process.argv[3]),R=require(process.argv[4]);let d='';"
        "process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const b=JSON.stringify(a);"
        "if(a.q!==undefined){const rf=F.findRunCases(a.results,a.runRows,a.q,r=>({req:String(r.query??''),ans:String(r.response??'')}));"
        "const vis=a.order?a.order.filter(p=>rf.shown.includes(p)):rf.shown;"
        "a.list=F.runMatchList(a.results,vis,(p,id)=>!!a.runRows[p]&&a.runRows[p].id===id);}"
        "const o=R.buildRunFindExport({...a,build:E.buildEvaluatedDataset,buildList:X.buildCaseListExport});"
        "o.full=(E.buildEvaluatedDataset(a).text||'');o.list=a.list;o.unchanged=a.q!==undefined||JSON.stringify(a)===b;"
        "process.stdout.write(JSON.stringify(o))})")


def run(**a):
    out = subprocess.run(["node", "-e", CODE, *(str(ST / f) for f in ("evaluated_dataset.js", "case_list_export.js", "case_find.js", "run_find_export.js"))],
                         input=json.dumps(a), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


ROWS = [{"id": 7, "query": "refund please", "response": "ok", "x_unknown": {"k": None}, "human_groundedness": 5},
        {"id": "7", "query": "refund later", "response": "ok2", "source": "user-authored"},
        {"query": "refund no id", "response": "r3", "tool_definitions": None},
        {"id": "sup-01", "query": "refund dup A", "response": "r4"},
        {"id": "sup-01", "query": "refund dup B", "response": "r5"},
        {"id": "zz", "query": "other", "response": "r6"}]
RES = [{"id": 7, "jev": {"g": 2}}, {"id": "7", "jev": {"g": 3}}, {"jev": {"g": 4}}, {"id": "sup-01"}, {"id": "sup-01"}, {"id": "zz"}]
SUM = {"version": "vT", "at": "2026-09-29T00:00:00Z"}
line = lambda r: json.dumps(r, separators=(",", ":"), ensure_ascii=False)


def test_search_projection_in_shown_order_typed_dup_absent_exact_bytes():
    o = run(runRows=ROWS, results=RES, summary=SUM, q="refund", order=[4, 0, 2, 1, 3, 5])
    assert o["ok"] and o["n"] == 5 and o["shown"] == 5 and o["excluded"] == [] and o["positions"] == [4, 0, 2, 1, 3]
    assert o["text"] == "".join(line(ROWS[p]) + "\n" for p in [4, 0, 2, 1, 3])
    full = o["full"].splitlines()
    assert o["text"].splitlines() == [full[p] for p in [4, 0, 2, 1, 3]]
    got = [json.loads(x) for x in o["text"].splitlines()]
    assert got[1]["id"] == 7 and got[3]["id"] == "7" and "id" not in got[2] and got[2]["tool_definitions"] is None
    assert got[1]["x_unknown"] == {"k": None} and "jev" not in o["text"] and "score" not in o["text"]


def test_numeric_vs_string_id_search_keeps_types():
    o = run(runRows=ROWS, results=RES, summary=SUM, q="7")
    assert o["ok"] and o["ids"] == [7, "7"] and o["positions"] == [0, 1]


def test_unbound_rows_are_excluded_and_counted_never_substituted():
    rows = [dict(ROWS[0]), {"id": 7, "query": "refund ghost", "response": "x"}] + ROWS[2:]   # row 1 frozen id 7 vs result "7"
    o = run(runRows=rows, results=RES, summary=SUM, list=[{"pos": 0, "id": 7}, {"pos": 1, "id": "7", "open": False}, {"pos": 3, "id": "sup-01"}])
    assert o["ok"] and o["n"] == 2 and o["shown"] == 3 and o["excluded"] == [{"pos": 1, "id": "7"}]
    assert "ghost" not in o["text"] and o["text"] == line(rows[0]) + "\n" + line(rows[3]) + "\n"
    only = run(runRows=rows, results=RES, summary=SUM, list=[{"pos": 1, "id": "7"}])
    assert not only["ok"] and only["reason"] == "none_bound" and "text" not in only


def test_empty_nomatch_partial_midrun_norun_stale_key_refuse():
    assert run(runRows=ROWS, results=RES, summary=SUM, q="nothing-matches")["reason"] == "empty"
    assert run(runRows=ROWS, results=RES, summary=SUM, list=[])["reason"] == "empty"
    assert run(runRows=ROWS, results=RES[:3], summary=None, list=[{"pos": 0, "id": 7}])["reason"] == "partial"
    assert run(runRows=[], results=[], summary=None, list=[{"pos": 0, "id": 7}])["reason"] in ("none_bound", "no_run")
    # a listed entry with a wrong typed id is excluded (not bound), never a different row
    o = run(runRows=ROWS, results=RES, summary=SUM, list=[{"pos": 0, "id": "7"}, {"pos": 1, "id": "7"}])
    assert o["ok"] and o["positions"] == [1] and o["excluded"] == [{"pos": 0, "id": "7"}]
    # duplicate position = stale (whole file refused by the shared list exporter)
    assert run(runRows=ROWS, results=RES, summary=SUM, list=[{"pos": 1, "id": "7"}, {"pos": 1, "id": "7"}])["reason"] == "stale"
    k = [dict(ROWS[0], note="SECRETKEY123")] + ROWS[1:]
    assert run(runRows=k, results=RES, summary=SUM, key="SECRETKEY123", list=[{"pos": 1, "id": "7"}])["reason"] == "key_in_rows"


def test_input_not_mutated():
    assert run(runRows=ROWS, results=RES, summary=SUM, list=[{"pos": 3, "id": "sup-01"}])["unchanged"]


def test_real_retained_run_roundtrip():
    d = ROOT / "tests" / "fixtures" / "real-2run-t80f"
    cands = sorted(d.glob("*")) if d.exists() else []
    st = next((json.loads(p.read_text()) for p in cands if p.suffix == ".json" and "runRows" in p.read_text()[:200000]), None)
    if not st:
        pytest.skip("retained real run fixture shape not found")
    rr, res = st["runRows"], st["results"]
    s = st.get("summary") or SUM
    o = run(runRows=rr, results=res, summary=s, q="7")
    if not o.get("ok"):
        pytest.skip("no match in retained run")
    assert [json.loads(x) for x in o["text"].splitlines()] == [rr[p] for p in o["positions"]]


def test_app_wiring():
    js = (ST / "app.js").read_text(); html = (ST / "index.html").read_text()
    assert "run_find_export.js" in html and html.index("case_list_export.js") < html.index("run_find_export.js") < html.index("app.js\"")
    assert "buildRunFindExport" in js and "shown cases (.jsonl)" in js and "rfxPrev" in js
