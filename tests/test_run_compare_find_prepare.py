"""t_512b4b31: prepare ONLY the cases a comparison search shows. Composition under test (same as app.js rcSPNow/rcSPCompute):
runCompareMatchedList | runCompareChanges.shown -> runCompareFind -> {pos, id} -> prepareRerun.
SYNTHETIC fixtures (stored fixture scores, not live judge output) + static wiring checks on app.js."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const RC=require(process.argv[1]),P=require(process.argv[2]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
        "const a=JSON.parse(d),b0=JSON.stringify(a);const r=RC.buildRunCompare(a.base,a.cur);const tx=x=>({req:x.query,ans:x.response});"
        "const L=a.k==='dataset'?RC.runCompareMatchedList(r,a.t):RC.runCompareChanges(r,'jev','intent_resolution',a.k).shown.map(x=>({pos:x.current_pos,id:x.id,b:x.baseline_pos}));"
        "const F=RC.runCompareFind(L,a.base.rows,a.cur.rows,a.q,tx);"
        "const o=F.active&&F.shown.length?P.prepareRerun({members:F.shown.map(e=>({pos:e.pos,id:e.id})),runRows:a.cur.rows,runPos:a.rp,rows:a.rows,selected:new Set(a.sel)}):{ok:false,reason:'no_action'};"
        "o.F=F;o.unchanged=JSON.stringify(a)===b0;process.stdout.write(JSON.stringify(o))})")
IR = "intent_resolution"
BROWS = [{"id": 7, "query": "refund please", "response": "r"}, {"id": "7", "query": "parcel", "response": "In transit"},
         {"id": "ctx", "query": "q3", "response": "OLD answer"}, {"id": "up", "query": "q4", "response": "r4"}]
BRES = [{"id": 7, "jev": {IR: 4}}, {"id": "7", "jev": {IR: 5}}, {"id": "ctx", "jev": {IR: 5}}, {"id": "up", "jev": {IR: 2}}]
CROWS = [{"id": "up", "query": "q4", "response": "r4"}, {"id": "7", "query": "parcel", "response": "In transit"},
         {"id": "ctx", "query": "q3", "response": "new answer"}, {"id": 7, "query": "refund please", "response": "r"}]
CRES = [{"id": "up", "jev": {IR: 3}}, {"id": "7", "jev": {IR: 3}}, {"id": "ctx", "jev": {IR: 1}}, {"id": 7, "jev": {IR: 3}}]
cp = lambda x: json.loads(json.dumps(x))


def run(k="dataset", t="all", q="7", rows=None, rp=None, sel=()):
    a = {"base": {"rows": BROWS, "results": BRES}, "cur": {"rows": CROWS, "results": CRES, "complete": True},
         "k": k, "t": t, "q": q, "rows": cp(CROWS) if rows is None else rows, "rp": rp, "sel": list(sel)}
    return json.loads(subprocess.run(["node", "-e", CODE, str(ST / "run_compare.js"), str(ST / "slow_prepare.js")],
                                     input=json.dumps(a), capture_output=True, text=True, check=True).stdout)


def test_prepares_exactly_the_shown_typed_ids_not_the_whole_list():
    o = run(q="7", rp=[0, 1, 2, 3], sel=[0])
    assert o["unchanged"] and o["ok"]
    assert [e["id"] for e in o["F"]["shown"]] == ["7", 7] and o["F"]["total"] == 4          # 2 shown of 4
    assert o["after"]["positions"] == [1, 3] and o["after"]["ids"] == ["7", 7]               # number 7 and text "7" both, separate
    assert o["before"]["positions"] == [0] and o["added"] == 2 and o["removed"] == 1
    # trace-text search in the decreases list: only 7 (refund) of the decreased cases
    d = run(k="dec", q="refund", rp=[0, 1, 2, 3])
    assert [e["id"] for e in d["F"]["shown"]] == [7] and d["after"]["ids"] == [7]
    # increases list: "up" only when searched
    i = run(k="inc", q="q4", rp=None)
    assert i["ok"] and i["after"]["ids"] == ["up"]


def test_no_match_and_empty_query_have_no_action_never_all():
    assert run(q="zzz")["reason"] == "no_action" and run(q="zzz")["F"]["shown"] == []
    e = run(q="   ")
    assert e["reason"] == "no_action" and not e["F"]["active"]                                 # blank = no search = no scoped prepare


def test_edited_missing_ambiguous_refuse_selection_untouched():
    r = run(q="7", rows=[CROWS[0], {"id": 7, "query": "parcel", "response": "In transit"}] + cp(CROWS[2:]), sel=[2])
    assert not r["ok"] and any(p["id"] == "7" for p in r["problems"]) and r["before"]["positions"] == [2]   # number where text was
    ed = cp(CROWS); ed[3]["human_intent_resolution"] = 1
    r = run(q="7", rows=ed, rp=[0, 1, 2, 3])
    assert not r["ok"] and any("changed since the run" in p["why"] for p in r["problems"])
    r = run(q="7", rows=cp(CROWS) + [cp(CROWS[1])])
    assert not r["ok"] and any("ambiguous" in p["why"] for p in r["problems"])
    assert run(q="7", rows=[])["reason"] == "no_dataset"


def test_app_wiring_scoped_prepare_bound_explicit_and_labelled():
    s = (ST / "app.js").read_text()
    a = s.index("// t_512b4b31: prepare ONLY"); c = s.index("\n}\n", s.index("function rcSPWire")); blk = s[a:c]
    assert "${FF?.active && FF.shown.length ? rcSPHTML(r, FF) + rcSDHTML(r, FF) : \"\"}" in s   # t_f1cb925e adds scoped Download beside it                  # only for a nonempty active search
    assert "S.pv.rc.q = v; S.pv.rc.prep = null; S.pv.rc.sprep = null;" in s                   # query change drops it
    assert "if (S.pv.rc.sprep && !rcSPValid(S.pv.rc.sprep)) S.pv.rc.sprep = null;" in s
    assert "P.q !== rcQ()" in blk and "v.ord === P.ord && v.trace === P.trace && v.key === P.key && rcSPList(v.F) === P.list" in blk
    assert "rcFind(runCompareMatchedList(now, trace))" in blk and "prepareRerun({ members: rcSPMembers(F)" in blk
    assert "P.sig !== prepSig()" in blk and "never half-apply" in blk and 'kind: "compare-search"' in blk
    assert "not a verified improvement or an accuracy gain" in blk and "not the whole list" in blk
    for bad in ("fetch(", "api(", "runBtn", "S.rows =", "S.results =", "localStorage", "download(", "rcSPOk\").click"):
        assert bad not in blk, bad
    assert "Search does not narrow Download or Prepare below:" in s                          # full-list scope still labelled
    assert 'pn.kind === "compare-search" ? "a search in Compare with recorded run"' in s
    # typing only re-renders the view; it never computes/sets sprep
    f = s[s.index("function rcSetQ"):s.index("function rcFindWire")]
    assert "rcSPCompute" not in f and "sprep = {" not in f
