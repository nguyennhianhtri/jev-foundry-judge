"""t_c1326574: focus the failed-case list on one RECORDED judge / metric (failFocus / failFocusOptions).
Failures are a clearly labelled DETERMINISTIC FAULT SIMULATION in the exact shapes the app emits; not vendor failures."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
IR, GR, TA = "intent_resolution", "groundedness", "task_adherence"
CODE = ("const F=require(process.argv[1]),D=require(process.argv[2]);let d='';"
        "process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const b0=JSON.stringify(a);"
        "const A=F.failedCases({results:a.results,runCfg:a.cfg});const out={};"
        "for(const [k,f] of Object.entries(a.focus)){const X=F.failFocus(A,f);const L=F.failNavList(X);"
        "const walk=[];let cur=L[0];while(cur){walk.push([cur.pos,cur.id]);const s=D.distNavStep(L,cur.pos,cur.id,1);cur=s.ok?L[s.i]:null;}"
        "out[k]={n:X.members.length,T:X.failed_total,rows:X.rows,walk,key:F.failNavKey(L),all:X.focus.all,"
        "opts:F.failFocusOptions(A,f.judge)};}"
        "out.allKey=F.failNavKey(F.failNavList(A));out.unchanged=JSON.stringify(a)===b0;"
        "process.stdout.write(JSON.stringify(out))})")

def ok(i, ir=4.5, gr=3.0):
    return {"id": i, "jev": {IR: ir, GR: gr, TA: 4.0}, "jev_detail": {m: {"result": "pass"} for m in (IR, GR, TA)}}

LOK = {IR: {"score": 4}, GR: {"score": 3}, TA: {"score": 4}}
CFG = {"metrics": [IR, GR, TA], "baseline_requested": True}
RES = [dict({"id": 7, "error": "Jev error 500"}, llm=LOK),                                           # 0 row-level Jev
       dict(ok("7", ir=1.1), llm=LOK),                                                               # 1 LOW, not failure
       dict(ok("dup"), llm={**LOK, IR: {"score": None, "error": "TimeoutError"}, GR: {"score": None, "error": "429"}}),  # 2 LLM IR+GR
       dict(ok("dup"), llm=LOK),                                                                     # 3 dup ok
       dict(ok("x"), llm={**LOK, GR: {"score": None, "error": "429"}}),                              # 4 LLM GR
       dict(ok("na"), llm=LOK),                                                                      # 5 n/a
       dict(ok("m"), llm={IR: {"score": 4}}),                                                        # 6 not recorded GR/TA
       dict(ok(8), llm=LOK)]
RES[5]["jev_detail"][GR] = {"result": "not_applicable"}; RES[5]["jev"][GR] = None
RES[7]["jev"][TA] = None; RES[7]["jev_detail"][TA] = {"result": "fail", "reason": "parse"}          # 7 Jev metric TA
RES[7]["llm"] = {**LOK, TA: {"score": None, "error": "TimeoutError"}}                               # + LLM TA -> multi
FOCUS = {"all": {}, "llm": {"judge": "llm"}, "jev": {"judge": "jev"}, "gr": {"metric": GR},
         "llm_gr": {"judge": "llm", "metric": GR}, "row": {"metric": "__row"}, "jev_ta": {"judge": "jev", "metric": TA},
         "ta": {"metric": TA}, "empty": {"judge": "jev", "metric": GR}}

@pytest.fixture(scope="module")
def o():
    r = subprocess.run(["node", "-e", CODE, str(ST / "failed_cases.js"), str(ST / "score_dist.js")],
                       input=json.dumps({"results": RES, "cfg": CFG, "focus": FOCUS}), capture_output=True, text=True, check=True)
    return json.loads(r.stdout)

def test_all_is_default_unchanged(o):
    assert o["all"]["all"] and o["all"]["key"] == o["allKey"] and o["all"]["n"] == o["all"]["T"] == 4
    assert o["all"]["walk"] == [[0, 7], [2, "dup"], [4, "x"], [7, 8]] and o["unchanged"]

def test_counts_each_row_once_and_run_order(o):
    assert o["llm"]["walk"] == [[2, "dup"], [4, "x"], [7, 8]] and o["llm"]["n"] == 3 and o["llm"]["T"] == 4 and o["llm"]["rows"] == 8
    assert o["gr"]["walk"] == [[2, "dup"], [4, "x"]]                     # row 2 has two LLM failures, counted once
    assert o["ta"]["walk"] == [[7, 8]] and o["jev_ta"]["walk"] == [[7, 8]]
    assert o["row"]["walk"] == [[0, 7]] and o["jev"]["walk"] == [[0, 7], [7, 8]]

def test_empty_focus_and_typed_ids(o):
    assert o["empty"]["n"] == 0 and o["empty"]["walk"] == [] and o["empty"]["T"] == 4
    assert all(p != 1 for p, _ in o["all"]["walk"])                     # text "7" LOW score never a member

def test_options_only_from_recorded_failures(o):
    assert o["all"]["opts"] == {"judges": ["jev", "llm"], "metrics": ["__row", IR, GR, TA]}
    assert o["llm"]["opts"]["metrics"] == [IR, GR, TA] and o["jev"]["opts"]["metrics"] == ["__row", TA]

def test_scope_key_differs_so_stale_inspector_refuses(o):
    assert o["llm"]["key"] != o["allKey"] and o["gr"]["key"] != o["llm"]["key"]

def test_app_single_visible_scope():
    s = (ST / "app.js").read_text()
    assert "const failNow = () => { const A = failAll(), f = failFilt(); return failFocus(A, f); };" in s
    assert 'id="failJudge"' in s and 'id="failMetric"' in s and "shown of <b>${T}</b> failed row" in s
    assert s.count("failNow()") >= 6 and "Scope: ${esc(failScopeTxt(F))}" in s and "Failed cases of this run · ${esc(failScopeTxt(F))}" in s
