"""t_028e8703: Jev score distribution over a completed run (app/static/score_dist.js). Fixtures labelled SYNTHETIC
except the retained real run (tests/fixtures/real-run-t389-key1440-frozen-state.json, real Jev scores)."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const D=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);"
        "const before=JSON.stringify(a.results);const o={};"
        "o.dist=D.scoreDist(a.results,a.m,{metrics:a.metrics,threshold:a.th});"
        "o.def=D.defaultMetric(a.results,a.metrics,a.th);"
        "o.res=(a.probe||[]).map(p=>D.resolveDistCase(a.results,a.runRows,p[0],p[1]));"
        "o.unchanged=JSON.stringify(a.results)===before;process.stdout.write(JSON.stringify(o))})")


def run(results, m, metrics=None, th=3, runRows=None, probe=None):
    out = subprocess.run(["node", "-e", CODE, str(ST / "score_dist.js")], input=json.dumps(
        {"results": results, "m": m, "metrics": metrics, "th": th, "runRows": runRows or [], "probe": probe}),
        capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


GR = "groundedness"
# SYNTHETIC boundary fixture: exact edges and just-below values
BOUND = [{"id": i, "jev": {GR: v}} for i, v in enumerate([1, 1.999, 2, 2.9999, 3, 3.95, 4, 4.9999, 5])]


def bins(d):
    return {b["key"]: [it["id"] for it in b["items"]] for b in d["bins"]}


def test_boundaries_half_open_no_rounding():
    d = run(BOUND, GR, [GR])["dist"]
    assert bins(d) == {"1-2": [0, 1], "2-3": [2, 3], "3-4": [4, 5], "4-5": [6, 7, 8]}
    assert d["scored"] == 9 and d["excluded_n"] == 0 and d["below_threshold"] == 4
    assert [b["label"] for b in d["bins"]] == ["1 ≤ score < 2", "2 ≤ score < 3", "3 ≤ score < 4", "4 ≤ score ≤ 5"]


def test_missing_is_never_zero_and_reasons_counted():
    # SYNTHETIC n/a / error / missing / out-of-range fixture
    R = [{"id": "a", "jev": {GR: 4.5}},
         {"id": "na", "jev": {GR: None}, "jev_detail": {GR: {"result": "not_applicable"}}},
         {"id": "err", "error": "Jev error 500", "jev": {}},
         {"id": "none", "jev": {GR: None}},
         {"id": "zero", "jev": {GR: 0}},
         {"id": "str", "jev": {GR: "2"}},
         {"id": "bool", "jev": {GR: True}}]
    d = run(R, GR, [GR])["dist"]
    assert d["scored"] == 1 and d["rows"] == 7 and d["excluded_n"] == 6
    assert d["excluded"] == {"not applicable": 1, "row error": 1, "no score recorded": 3, "outside 1–5": 1}
    assert sum(b["n"] for b in d["bins"]) == 1 and d["mean"] == 4.5


def test_empty_run_and_metric_not_in_run():
    d = run([], GR, [GR])["dist"]
    assert d["scored"] == 0 and d["mean"] is None and d["rows"] == 0
    d = run([{"id": 1, "jev": {GR: 4}}], "intent_resolution", [GR])["dist"]
    assert not d["in_run"] and d["scored"] == 0 and d["excluded"] == {"metric not in this run": 1}


def test_default_metric_most_below_threshold_then_lowest_mean():
    R = [{"id": 1, "jev": {"intent_resolution": 4.9, GR: 2.0}}, {"id": 2, "jev": {"intent_resolution": 2.5, GR: 4.0}},
         {"id": 3, "jev": {"intent_resolution": 4.8, GR: 1.5}}]
    assert run(R, GR, ["intent_resolution", GR])["def"] == GR
    R2 = [{"id": 1, "jev": {"intent_resolution": 4.0, GR: 4.5}}]
    assert run(R2, GR, ["intent_resolution", GR])["def"] == "intent_resolution"
    assert run([], GR, [GR])["def"] == GR


def test_resolve_typed_id_and_position_only():
    R = [{"id": 7, "jev": {GR: 2}}, {"id": "7", "jev": {GR: 2}}]
    rr = [{"id": 7}, {"id": "7"}]
    o = run(R, GR, [GR], runRows=rr, probe=[[0, 7], [1, "7"], [0, "7"], [5, 7]])
    assert [r["ok"] for r in o["res"]] == [True, True, False, False] and o["unchanged"]


def test_real_retained_run_recount_independently():
    st = json.loads((ROOT / "tests/fixtures/real-run-t389-key1440-frozen-state.json").read_text())
    res, metrics, th = st["results"], st["runCfg"]["metrics"], st["summary"]["threshold"]
    for m in metrics:
        d = run(res, m, metrics, th)["dist"]
        vals = [x["jev"].get(m) for x in res]
        num = [v for v in vals if isinstance(v, (int, float)) and not isinstance(v, bool)]
        assert d["scored"] == len(num) and d["excluded_n"] == len(res) - len(num)
        assert d["bins"][0]["n"] == sum(1 <= v < 2 for v in num) and d["bins"][3]["n"] == sum(4 <= v <= 5 for v in num)
        assert d["below_threshold"] == sum(v < th for v in num)
        for b in d["bins"]:
            assert [it["pos"] for it in b["items"]] == sorted(it["pos"] for it in b["items"])


def test_wired_in_page_and_dashboard():
    html = (ST / "index.html").read_text()
    assert html.index("score_dist.js") < html.index("/static/app.js") and 'id="distCard"' in html
    app = (ST / "app.js").read_text()
    assert "scoreDist(S.results" in app and "resolveDistCase(S.results, S.runRows" in app
