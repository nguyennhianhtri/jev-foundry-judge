"""t_f1cb925e: DOWNLOAD only the cases a comparison search shows. Composition under test (same as app.js rcSPNow/rcSDBuild):
runCompareMatchedList | runCompareChanges.shown -> runCompareFind -> {pos, id} -> buildCaseListExport(evaluated-dataset serializer).
SYNTHETIC fixtures (stored fixture scores, not live judge output) + static wiring checks on app.js."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const RC=require(process.argv[1]),X=require(process.argv[2]),E=require(process.argv[3]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
        "const a=JSON.parse(d),b0=JSON.stringify(a);const r=RC.buildRunCompare(a.base,a.cur);const tx=x=>({req:x.query,ans:x.response});"
        "const L=a.k==='dataset'?RC.runCompareMatchedList(r,a.t):RC.runCompareChanges(r,'jev','intent_resolution',a.k).shown.map(x=>({pos:x.current_pos,id:x.id,b:x.baseline_pos}));"
        "const F=RC.runCompareFind(L,a.base.rows,a.cur.rows,a.q,tx);"
        "const o=F.active&&F.shown.length?X.buildCaseListExport({runRows:a.cur.rows,results:a.cur.results,summary:a.sum,key:a.key,list:F.shown.map(e=>({pos:e.pos,id:e.id})),build:E.buildEvaluatedDataset}):{ok:false,reason:'no_action'};"
        "o.F=F;o.unchanged=JSON.stringify(a)===b0;process.stdout.write(JSON.stringify(o))})")
IR = "intent_resolution"
BROWS = [{"id": 7, "query": "refund please", "response": "r", "meta": {"k": [1, None]}}, {"id": "7", "query": "parcel", "response": "In transit"},
         {"id": "ctx", "query": "q3", "response": "OLD answer"}, {"id": "up", "query": "q4", "response": "r4"}]
BRES = [{"id": 7, "jev": {IR: 4}}, {"id": "7", "jev": {IR: 5}}, {"id": "ctx", "jev": {IR: 5}}, {"id": "up", "jev": {IR: 2}}]
CROWS = [{"id": "up", "query": "q4", "response": "r4"}, {"id": "7", "query": "parcel", "response": "In transit", "x_unknown": None, "human_intent_resolution": 3},
         {"id": "ctx", "query": "q3", "response": "new answer"}, {"id": 7, "query": "refund please", "response": "r", "meta": {"k": [1, None]}}]
CRES = [{"id": "up", "jev": {IR: 3}}, {"id": "7", "jev": {IR: 3}}, {"id": "ctx", "jev": {IR: 1}}, {"id": 7, "jev": {IR: 3}}]
SUM = {"version": "vT", "at": "2026-09-29T00:00:00Z"}
line = lambda r: json.dumps(r, separators=(",", ":"), ensure_ascii=False)


def run(k="dataset", t="all", q="7", cur_rows=None, cur_res=None, key=None):
    a = {"base": {"rows": BROWS, "results": BRES}, "cur": {"rows": CROWS if cur_rows is None else cur_rows, "results": CRES if cur_res is None else cur_res, "complete": True},
         "k": k, "t": t, "q": q, "sum": SUM, "key": key}
    return json.loads(subprocess.run(["node", "-e", CODE, str(ST / "run_compare.js"), str(ST / "case_list_export.js"), str(ST / "evaluated_dataset.js")],
                                     input=json.dumps(a), capture_output=True, text=True, check=True).stdout)


def test_downloads_exactly_shown_current_rows_in_shown_order_typed():
    o = run(q="7")
    assert o["unchanged"] and o["ok"], o
    assert [e["id"] for e in o["F"]["shown"]] == ["7", 7] and o["F"]["total"] == 4
    assert o["ids"] == ["7", 7] and o["positions"] == [1, 3] and o["n"] == 2 and o["total"] == 4
    # current-run frozen rows byte-identical (labels, unknown fields, nulls kept); no scores; not the baseline rows
    assert o["text"] == line(CROWS[1]) + "\n" + line(CROWS[3]) + "\n"
    assert "jev" not in o["text"] and "refund please" in o["text"] and '"x_unknown":null' in o["text"]
    # input-changed case exports the CURRENT answer, never the baseline one
    c = run(q="answer")
    assert c["ok"] and c["ids"] == ["ctx"] and "new answer" in c["text"] and "OLD answer" not in c["text"]
    d = run(k="dec", q="refund")
    assert d["ok"] and d["ids"] == [7] and d["text"] == line(CROWS[3]) + "\n"


def test_no_match_blank_no_action_and_key_or_partial_refuse():
    assert run(q="zzz")["reason"] == "no_action"
    assert run(q="   ")["reason"] == "no_action"
    assert not run(q="7", key="refund please")["ok"]                                            # key text in rows refuses
    assert not run(q="7", cur_res=CRES[:3])["ok"]                                               # misaligned/partial run refuses


def test_app_wiring_scoped_download_bound_explicit_labelled():
    s = (ST / "app.js").read_text()
    a = s.index("// t_f1cb925e: DOWNLOAD only"); c = s.index("\n}\n", s.index("function rcSDWire")); blk = s[a:c]
    assert 'rcSPHTML(r, FF) + rcSDHTML(r, FF) : ""' in s                                        # only under an active nonempty search
    assert "S.pv.rc.sprep = null; S.pv.rc.sdl = null;" in s                                       # query change drops it
    assert "if (S.pv.rc.sdl && !rcSDValid(S.pv.rc.sdl)) S.pv.rc.sdl = null;" in s
    assert "buildCaseListExport({ runRows: S.runRows, results: S.results, summary: S.summary, list: rcSPMembers(F), build: evalExport })" in blk
    assert "const v = rcSPNow()" in blk and "rcSPList(v.F) === P.list" in blk and "P.q !== rcQ()" in blk
    assert "x.text !== P.x.text" in blk and "nothing was downloaded" in blk
    assert "these ${n} shown cases`} (.jsonl)" in blk and "never the baseline file" in blk
    for bad in ("fetch(", "api(", "S.selected =", "S.rows =", "S.results =", "localStorage", "prepareRerun", "go(\"run\")"):
        assert bad not in blk, bad
    assert blk.count("download(") == 1                                                           # only in the explicit confirm
    # full-list Download/Prepare unchanged and still labelled, now pointing at both scoped actions
    assert "Search does not narrow Download or Prepare below:" in s and "rcDecExport()" not in blk
    f = s[s.index("function rcSetQ"):s.index("function rcFindWire")]
    assert "rcSDBuild" not in f and "sdl = {" not in f
