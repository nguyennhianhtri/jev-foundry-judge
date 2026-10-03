"""t_3d3710ee: view-only search inside Compare with recorded run (run_compare.js runCompareFind) + wiring.
SYNTHETIC fixtures (same shape as test_run_compare_matched_nav.py); scores are fixture values."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const RC=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
        "const a=JSON.parse(d),b0=JSON.stringify(a);const r=RC.buildRunCompare(a.base,a.cur);const tx=x=>({req:x.query,ans:x.response});"
        "const out={};for(const [k,t,q] of a.qs){const L=k==='dec'?RC.runCompareDecreases(r,'jev','intent_resolution').shown.map(x=>({pos:x.current_pos,id:x.id,b:x.baseline_pos})):RC.runCompareMatchedList(r,t);"
        "out[k+'|'+t+'|'+q]=RC.runCompareFind(L,a.base.rows,a.cur.rows,q,tx);}"
        "out.unchanged=JSON.stringify(a)===b0;process.stdout.write(JSON.stringify(out))})")
IR = "intent_resolution"
BROWS = [{"id": 7, "query": "refund please", "response": "r"}, {"id": "7", "query": "parcel", "response": "In transit"},
         {"id": "ctx", "query": "q3", "response": "OLD answer"}, {"id": "up", "query": "q4", "response": "r4"}]
BRES = [{"id": 7, "jev": {IR: 4}}, {"id": "7", "jev": {IR: 5}}, {"id": "ctx", "jev": {IR: 5}}, {"id": "up", "jev": {IR: 2}}]
CROWS = [{"id": "up", "query": "q4", "response": "r4"}, {"id": "7", "query": "parcel", "response": "In transit"},
         {"id": "ctx", "query": "q3", "response": "new answer"}, {"id": 7, "query": "refund please", "response": "r"}]
CRES = [{"id": "up", "jev": {IR: 3}}, {"id": "7", "jev": {IR: 3}}, {"id": "ctx", "jev": {IR: 1}}, {"id": 7, "jev": {IR: 3}}]
QS = [["m", "all", "7"], ["m", "all", "  "], ["m", "all", "old"], ["m", "all", "NEW"], ["m", "all", "zzz"],
      ["m", "same", "7"], ["m", "all", "In TRANSIT"], ["dec", "-", "7"], ["dec", "-", "refund"]]


def run():
    return json.loads(subprocess.run(["node", "-e", CODE, str(ST / "run_compare.js")],
                                     input=json.dumps({"base": {"rows": BROWS, "results": BRES}, "cur": {"rows": CROWS, "results": CRES, "complete": True}, "qs": QS}),
                                     capture_output=True, text=True, check=True).stdout)


def ids(r):
    return [[e["pos"], e["id"], e["hit"]] for e in r["shown"]]


def test_typed_ids_both_found_never_merged_in_list_order():
    o = run()
    r = o["m|all|7"]
    assert r["active"] and r["total"] == 4
    assert ids(r) == [[1, "7", ["id"]], [3, 7, ["id"]]]   # text "7" and number 7 stay two entries, current dataset order
    assert o["unchanged"]


def test_empty_query_is_inactive_full_list_and_no_match_honest():
    o = run()
    assert o["m|all|  "]["active"] is False and len(o["m|all|  "]["shown"]) == 4
    assert o["m|all|zzz"]["active"] and o["m|all|zzz"]["shown"] == [] and o["m|all|zzz"]["total"] == 4


def test_both_frozen_traces_searched_and_attributed():
    o = run()
    assert ids(o["m|all|old"]) == [[2, "ctx", ["baseline"]]]   # only in the recorded (file) trace
    assert ids(o["m|all|NEW"]) == [[2, "ctx", ["current"]]]     # case-insensitive, only in the current trace
    assert ids(o["m|all|In TRANSIT"]) == [[1, "7", ["baseline", "current"]]]


def test_narrows_group_and_decreases_list_only():
    o = run()
    assert ids(o["m|same|7"]) == [[1, "7", ["id"]], [3, 7, ["id"]]] and o["m|same|7"]["total"] == 3
    # decreases list = [7 (4->3), "7" (5->3)] sorted largest first; search keeps that order
    assert o["dec|-|7"]["total"] == 2 and [e["id"] for e in o["dec|-|7"]["shown"]] == ["7", 7]
    assert ids(o["dec|-|refund"]) == [[3, 7, ["baseline", "current"]]]


def test_app_wiring_one_projection_query_bound_nav_and_named_scope():
    src = (ST / "app.js").read_text()
    assert "runCompareFind(L, S.pv.o.rows, S.runRows, rcQ()" in src
    fresh = src[src.index("function rcNavFresh"):src.index("function rcDecHTML")]
    assert '(nav.q ?? "") !== rcQ()' in fresh and fresh.count("rcFind(") == 2
    assert "S.pv.rc.q = v; S.pv.rc.prep = null;" in src   # query change drops pending Prepare + re-render drops inspector
    assert "Search does not narrow Download or Prepare" in src and "Search not applied:" in src
    assert 'id="rcFind"' in src and "Find a case in this comparison" in src


def test_guards_escape_ime_and_active_query_stays_visible():
    src = (ST / "app.js").read_text()
    assert 'value="${esc(q)}"' in src and "“${esc(F.query)}”" in src
    assert "if (!e.isComposing) rcSetQ" in src and "oncompositionend" in src
    assert "(!F.total && !F.active)" in src
    rc = (ST / "run_compare.js").read_text()
    assert "toLocaleLowerCase" not in rc[rc.index("function runCompareFind"):]
