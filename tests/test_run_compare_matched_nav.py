"""t_b3ac81fe: Previous/Next over the dataset-order matched-case view (All matched / Same input / Input changed).
One projection (run_compare.js runCompareMatchedList) feeds BOTH the table rows and the inspector nav; stepping reuses
score_dist.js distNavStep. SYNTHETIC fixtures (same shape as test_run_compare_decreases_nav.py); scores are fixture values."""
import json, re, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const RC=require(process.argv[1]),SD=require(process.argv[2]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
        "const a=JSON.parse(d),b0=JSON.stringify(a);const r=RC.buildRunCompare(a.base,a.cur);const out={};"
        "for(const t of ['all','same','changed','bogus']){const L=RC.runCompareMatchedList(r,t);const walk=[];let cur=L[0];"
        "while(cur){walk.push([cur.pos,cur.id,cur.b,cur.trace]);const s=SD.distNavStep(L,cur.pos,cur.id,1);cur=s.ok?L[s.i]:null;}"
        "out[t]={L,walk,first:L.length?SD.distNavStep(L,L[0].pos,L[0].id,-1):null,last:L.length?SD.distNavStep(L,L[L.length-1].pos,L[L.length-1].id,1):null};}"
        "out.wrongType=SD.distNavStep(out.all.L,3,'7',1);out.bad=RC.runCompareMatchedList({ok:false},'all');"
        "out.unchanged=JSON.stringify(a)===b0;process.stdout.write(JSON.stringify(out))})")
IR = "intent_resolution"
BROWS = [{"id": 7, "query": "q", "response": "r"}, {"id": "7", "query": "q2", "response": "r2"}, {"id": "ctx", "query": "q3", "response": "old"},
         {"id": "up", "query": "q4", "response": "r4"}, {"id": "dup", "query": "d", "response": "d"}, {"id": "only-b", "query": "x", "response": "x"}]
BRES = [{"id": 7, "jev": {IR: 4}}, {"id": "7", "jev": {IR: 5}}, {"id": "ctx", "jev": {IR: 5}}, {"id": "up", "jev": {IR: 2}}, {"id": "dup", "jev": {IR: 5}}, {"id": "only-b", "jev": {IR: 5}}]
CROWS = [{"id": "up", "query": "q4", "response": "r4"}, {"id": "7", "query": "q2", "response": "r2"}, {"id": "ctx", "query": "q3", "response": "new"},
         {"id": 7, "query": "q", "response": "r"}, {"id": "dup", "query": "d", "response": "d"}, {"id": "dup", "query": "d", "response": "d"}]
CRES = [{"id": "up", "jev": {IR: 3}}, {"id": "7", "jev": {IR: 3}}, {"id": "ctx", "jev": {IR: 1}}, {"id": 7, "jev": {IR: 3}}, {"id": "dup", "jev": {IR: 1}}, {"id": "dup", "jev": {IR: 1}}]


def run():
    return json.loads(subprocess.run(["node", "-e", CODE, str(ST / "run_compare.js"), str(ST / "score_dist.js")],
                                     input=json.dumps({"base": {"rows": BROWS, "results": BRES}, "cur": {"rows": CROWS, "results": CRES, "complete": True}}),
                                     capture_output=True, text=True, check=True).stdout)


def test_matched_list_is_the_visible_projection_in_current_dataset_order():
    o = run()
    # current dataset order; number 7 and text "7" distinct; ambiguous dup and baseline-only never included/substituted
    assert o["all"]["walk"] == [[0, "up", 3, "same"], [1, "7", 1, "same"], [2, "ctx", 2, "changed"], [3, 7, 0, "same"]]
    assert o["same"]["walk"] == [[0, "up", 3, "same"], [1, "7", 1, "same"], [3, 7, 0, "same"]]
    assert o["changed"]["walk"] == [[2, "ctx", 2, "changed"]]
    assert o["bogus"]["L"] == [] and o["bad"] == []


def test_ends_disabled_and_typed_id_bound():
    o = run()
    for t in ("all", "same", "changed"):
        assert o[t]["first"] == {"ok": False, "edge": "first"} and o[t]["last"] == {"ok": False, "edge": "last"}
    assert o["wrongType"] == {"ok": False, "edge": None}   # pos 3 is number 7; text "7" never matches it
    assert o["unchanged"]


def test_app_wires_dataset_order_into_the_same_inspector():
    src = (ST / "app.js").read_text()
    # table rows and nav are the same projection; dataset nav goes through the same rcOpenCase/rcNavFresh guards
    assert "runCompareMatchedList(r, sel)" in src
    assert re.search(r'dir: "dataset"', src) and "runCompareMatchedList(now, nav.trace)" in src
    assert "Case <b>${i + 1}</b> of <b>${nav.L.length}</b> shown" in src


def test_nav_freshness_uses_effective_order_and_one_trace_sanitizer():
    src = (ST / "app.js").read_text()
    fresh = src[src.index("function rcNavFresh"):src.index("function rcDecHTML")]
    # no-pairs forces dataset order on render; a stale stored "dec" must not refuse dataset stepping
    assert '(now.pairs.length ? rcOrd() : "dataset") !== "dataset"' in fresh and "rcTr() !== nav.trace" in fresh
    assert "rcOrd() !== nav.dir" in fresh.split('nav.dir === "dataset"')[1]   # dec/inc guard unchanged, after the dataset branch
    assert "const sel = rcTr();" in src
