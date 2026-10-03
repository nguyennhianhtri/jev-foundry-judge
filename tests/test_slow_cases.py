"""t_1b23e244: slow cases behind the Dashboard Jev p95 headline. Threshold = the run's own summary p95 (stats.pct);
members independently recomputed here. Retained REAL run for the main case; labelled synthetic fixtures for ties/
missing/typed ids."""
import json, shutil, subprocess
from pathlib import Path
import pytest
from jev_foundry_judge.stats import pct, summarize

R = Path(__file__).resolve().parents[1]
JS = R / "app" / "static" / "slow_cases.js"
EV = R / "app" / "static" / "evaluated_dataset.js"
REAL = R / "tests" / "fixtures" / "real-run-t389-key1440-frozen-state.json"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def node(body, **kw):
    code = ("const L=require(process.argv[1]);const E=require(process.argv[2]);const A=JSON.parse(process.argv[3]);"
            "process.stdout.write(JSON.stringify((()=>{" + body + "})()))")
    return json.loads(subprocess.run(["node", "-e", code, str(JS), str(EV), json.dumps(kw)], capture_output=True, text=True, check=True).stdout)


def test_real_run_members_match_independent_recompute_and_export_is_exact():
    st = json.loads(REAL.read_text()); res, rr = st["results"], st["runRows"]
    summ = summarize(res)                                    # current server method
    p95 = summ["jev"]["p95_ms"]
    assert p95 == pct([r["jev_meta"]["latency_ms"] for r in res], .95)
    summ.update(at="t", version="v")
    o = node("const s=JSON.stringify([A.r,A.rr,A.s]);const sc=L.slowCases({results:A.r,summary:A.s});"
             "const x=L.slowExport({sc,runRows:A.rr,results:A.r,summary:A.s,key:null,build:E.buildEvaluatedDataset});"
             "return {sc,x,same:JSON.stringify([A.r,A.rr,A.s])===s}", r=res, rr=rr, s=summ)
    sc = o["sc"]
    want = sorted([i for i, r in enumerate(res) if r["jev_meta"]["latency_ms"] >= p95], key=lambda i: (-res[i]["jev_meta"]["latency_ms"], i))
    assert [e["pos"] for e in sc["members"]] == want and len(want) >= 1
    assert sc["denominator"] == 7 and sc["excluded_n"] == 0 and sc["small_n"] and sc["p95"] == p95
    assert o["x"]["ok"] and o["x"]["text"] == "".join(json.dumps(rr[i], separators=(",", ":"), ensure_ascii=False) + "\n" for i in want)
    assert o["same"]


def test_fixture_ties_missing_typed_duplicates():
    # labelled synthetic fixture
    r = [{"id": 7, "jev_meta": {"latency_ms": 900}}, {"id": "7", "jev_meta": {"latency_ms": 900}},
         {"id": "dup", "jev_meta": {"latency_ms": 100}}, {"id": "dup", "jev_meta": {"latency_ms": 950}},
         {"id": "e", "error": "boom"}, {"id": "n", "jev_meta": {"latency_ms": None}}]
    o = node("return L.slowCases({results:A.r,summary:{jev:{p95_ms:900}}})", r=r)
    assert [(e["pos"], e["id"]) for e in o["members"]] == [(3, "dup"), (0, 7), (1, "7")]
    assert o["ties"] == 2 and o["denominator"] == 4 and o["excluded_n"] == 2
    assert o["excluded"] == {"Jev call failed (error)": 1, "latency not recorded": 1}
    assert node("return [L.slowCases({results:A.r,summary:{jev:{p95_ms:null}}}).reason,L.slowCases({results:[],summary:{}}).reason]", r=r) == ["no_p95", "no_run"]
    nc = [{"id": "a", "jev_meta": {"latency_ms": 0, "calls": 0}}, {"id": "b", "jev_meta": {"latency_ms": 0, "calls": 0}}]
    assert node("return L.slowCases({results:A.r,summary:{jev:{p95_ms:0}}}).reason", r=nc) == "no_p95"   # no-call-only run is not 'slow'


def test_app_wiring_view_only():
    a = (R / "app/static/app.js").read_text(); h = (R / "app/static/index.html").read_text()
    assert h.index("slow_cases.js") < h.index("/static/app.js") and 'id="slowBar"' in h
    for k in ("Show slow cases (≥ p95)", "S.slow.ref !== S.results", 'S.metric !== "all")) { S.slow = null', "build: buildEvaluatedDataset", "never 0", "not the LLM judge's per-metric time", "Small sample"):
        assert k in a, k
    blk = a[a.index("function renderSlowBar"):a.index('$("#fOrder").onchange')]
    assert "api(" not in blk and "fetch(" not in blk and "S.results =" not in blk and ".sort(" not in blk
