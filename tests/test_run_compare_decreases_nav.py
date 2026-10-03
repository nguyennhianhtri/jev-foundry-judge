"""t_ee65b10f: Previous/Next over EXACTLY runCompareDecreases().shown, reusing score_dist.js distNavStep (no new
matching/scoring/state). SYNTHETIC fixtures (same as test_run_compare_decreases_export.py); scores are fixture values."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const RC=require(process.argv[1]),SD=require(process.argv[2]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
        "const a=JSON.parse(d),b0=JSON.stringify(a);const D=RC.runCompareDecreases(RC.buildRunCompare(a.base,a.cur),'jev',a.m);"
        "const L=D.shown.map(x=>({pos:x.current_pos,id:x.id,b:x.baseline_pos}));"
        "const walk=[];let cur=L[0];while(cur){walk.push([cur.pos,cur.id]);const s=SD.distNavStep(L,cur.pos,cur.id,1);cur=s.ok?L[s.i]:null;}"
        "const back=SD.distNavStep(L,L[L.length-1].pos,L[L.length-1].id,-1);"
        "process.stdout.write(JSON.stringify({L,walk,first:SD.distNavStep(L,L[0].pos,L[0].id,-1),last:SD.distNavStep(L,L[L.length-1].pos,L[L.length-1].id,1),back,"
        "wrongType:SD.distNavStep(L,L[0].pos,typeof L[0].id==='number'?String(L[0].id):Number(L[0].id),1),unchanged:JSON.stringify(a)===b0}))})")
IR = "intent_resolution"
BROWS = [{"id": 7, "query": "q", "response": "r"}, {"id": "7", "query": "q2", "response": "r2"}, {"id": "ctx", "query": "q3", "response": "old"},
         {"id": "up", "query": "q4", "response": "r4"}, {"id": "dup", "query": "d", "response": "d"}]
BRES = [{"id": 7, "jev": {IR: 4}}, {"id": "7", "jev": {IR: 5}}, {"id": "ctx", "jev": {IR: 5}}, {"id": "up", "jev": {IR: 2}}, {"id": "dup", "jev": {IR: 5}}]
CROWS = [{"id": "up", "query": "q4", "response": "r4"}, {"id": "7", "query": "q2", "response": "r2"}, {"id": "ctx", "query": "q3", "response": "new"},
         {"id": 7, "query": "q", "response": "r"}, {"id": "dup", "query": "d", "response": "d"}, {"id": "dup", "query": "d", "response": "d"}]
CRES = [{"id": "up", "jev": {IR: 3}}, {"id": "7", "jev": {IR: 3}}, {"id": "ctx", "jev": {IR: 1}}, {"id": 7, "jev": {IR: 3}}, {"id": "dup", "jev": {IR: 1}}, {"id": "dup", "jev": {IR: 1}}]


def test_steps_exactly_the_shown_decreases_in_order_bound_by_position_and_typed_id():
    o = json.loads(subprocess.run(["node", "-e", CODE, str(ST / "run_compare.js"), str(ST / "score_dist.js")],
                                  input=json.dumps({"base": {"rows": BROWS, "results": BRES}, "cur": {"rows": CROWS, "results": CRES, "complete": True}, "m": IR}),
                                  capture_output=True, text=True, check=True).stdout)
    # "7" (text, -2) then 7 (number, -1); ctx (changed input), dup (ambiguous), up (increase) never stepped to
    assert o["walk"] == [[1, "7"], [3, 7]] and [e["b"] for e in o["L"]] == [1, 0]
    assert o["first"] == {"ok": False, "edge": "first"} and o["last"] == {"ok": False, "edge": "last"}
    assert o["back"]["ok"] and o["back"]["id"] == "7" and o["back"]["pos"] == 1
    assert o["wrongType"] == {"ok": False, "edge": None}  # 7 != "7": never steps from a mistyped id
    assert o["unchanged"]
