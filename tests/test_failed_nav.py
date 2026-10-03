"""t_5a0f5b6a: step through failed cases (Previous/Next failed case) over the SAME failedCases members.
Failures here are a clearly labelled DETERMINISTIC FAULT SIMULATION in the exact shapes the app emits; not vendor failures."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const F=require(process.argv[1]),D=require(process.argv[2]);let d='';"
        "process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const b0=JSON.stringify(a);"
        "const f=F.failedCases({results:a.results,runCfg:a.cfg});const L=F.failNavList(f);"
        "const walk=[];let cur=L[0];while(cur){walk.push([cur.pos,cur.id]);const s=D.distNavStep(L,cur.pos,cur.id,1);cur=s.ok?L[s.i]:null;}"
        "const first=D.distNavStep(L,L[0].pos,L[0].id,-1),last=D.distNavStep(L,L[L.length-1].pos,L[L.length-1].id,1);"
        "const wrongType=D.distNavStep(L,0,'7',1);"
        "const k1=F.failNavKey(L);const r2=JSON.parse(JSON.stringify(a.results));r2[a.flip].error='changed';"
        "const k2=F.failNavKey(F.failNavList(F.failedCases({results:r2,runCfg:a.cfg})));"
        "process.stdout.write(JSON.stringify({L,walk,first,last,wrongType,same:k1===F.failNavKey(F.failNavList(F.failedCases({results:a.results,runCfg:a.cfg}))),changed:k1!==k2,unchanged:JSON.stringify(a)===b0}))})")
IR, GR = "intent_resolution", "groundedness"


def ok(i, ir=4.5):
    return {"id": i, "jev": {IR: ir, GR: 3.0}, "jev_detail": {IR: {"result": "pass"}, GR: {"result": "fail"}}}


CFG = {"metrics": [IR, GR], "baseline_requested": True}
LOK = {IR: {"score": 4}, GR: {"score": 3}}
RES = [dict({"id": 7, "error": "Jev error 500"}, llm=LOK),               # pos0 typed 7 fails
       dict(ok("7", ir=1.1), llm=LOK),                                   # pos1 text "7" LOW score -> not a failure
       dict(ok("dup"), llm={IR: {"score": None, "error": "TimeoutError"}, GR: {"score": 3}}),   # pos2 LLM failure
       dict(ok("dup"), llm=LOK),                                         # pos3 duplicate id, fine
       {"id": "dup", "error": "No evaluate() output for this row", "llm": LOK},                 # pos4 duplicate id fails
       dict(ok("na"), llm=LOK)]
RES[5]["jev_detail"][GR] = {"result": "not_applicable"}; RES[5]["jev"][GR] = None       # n/a is not a failure


def run(flip=5):
    out = subprocess.run(["node", "-e", CODE, str(ST / "failed_cases.js"), str(ST / "score_dist.js")],
                         input=json.dumps({"results": RES, "cfg": CFG, "flip": flip}), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_sequence_is_failedcases_run_order_typed_and_duplicates():
    o = run()
    assert o["walk"] == [[0, 7], [2, "dup"], [4, "dup"]]          # low score "7", ok dup and n/a excluded
    assert [r["why"] for r in o["L"][1]["reasons"]] == ["LLM judge error: TimeoutError"]
    assert o["L"][0]["reasons"][0]["metric"] is None and o["L"][0]["reasons"][0]["why"] == "Jev error 500"
    assert o["unchanged"]


def test_boundaries_and_typed_id_7_not_text_7():
    o = run()
    assert o["first"] == {"ok": False, "edge": "first"} and o["last"] == {"ok": False, "edge": "last"}
    assert o["wrongType"]["ok"] is False                         # pos0 with text "7" is not a member


def test_changed_list_detected_same_list_stable():
    o = run(flip=5)
    assert o["same"] and o["changed"]


def test_app_wiring_reuses_inspector_and_refuses_stale():
    s = (ST / "app.js").read_text()
    assert "openFailCase(p, S.results[p].id)" in s
    f = s[s.index("function openFailCase"):s.index("// t_0e89d114: the failed rows")]
    assert "showDetail(pos)" in f and "distNavStep(nav.L" in f and "failNavFresh(nav)" in f
    assert "Previous failed case" in f and "Next failed case" in f and "Failed case <b>" in f
    assert "fetch(" not in f and "api(" not in f and "S.selected" not in f and "S.rows" not in f
