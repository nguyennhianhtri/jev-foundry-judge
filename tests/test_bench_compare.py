"""t_4bcc0c48: same-workload cost/latency comparison (app/static/bench_compare.js).
REPLAY of the retained REAL frozen dual-judge benchmark (benchmark/results, 47 rows) recomputed independently here,
plus focused synthetic edge cases (equal/unequal scope, failures, no baseline, zero/missing data)."""
import json
import shutil
import statistics
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "app" / "static" / "bench_compare.js"
BENCH = ROOT / "benchmark" / "results"
MS = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def cmp(results, opt=None):
    code = ("const {buildBenchCompare}=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
            "const a=JSON.parse(d);process.stdout.write(JSON.stringify(buildBenchCompare(a.r,a.o)))})")
    out = subprocess.run(["node", "-e", code, str(JS)], input=json.dumps({"r": results, "o": opt or {}}),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def med(xs):
    return round(statistics.median(xs), 1)


def row(i, j=None, llm=None, jmeta=True, usd: float | None = 1e-4, lat=300.0, err=None):
    r = {"id": f"r{i}", "human": {}, "jev": j or {}, "jev_detail": {}}
    if jmeta:
        r["jev_meta"] = {"latency_ms": lat, "usd": usd, "input_tokens": 1000}
    if err:
        r["error"] = err
    if llm is not None:
        r["llm"] = llm
    return r


def L(score=4.0, lat=2000.0, usd=1e-3, result="pass"):
    return {"score": score, "latency_ms": lat, "usd": usd, "result": result}


def test_real_replay_matches_frozen_summary_and_independent_matched_scope():
    res = [json.loads(x) for x in (BENCH / "results.jsonl").read_text().splitlines() if x.strip()]
    old = json.loads((BENCH / "summary.json").read_text())
    c = cmp(res)
    # full-run figures agree with the authoritative backend summary that was frozen with the run
    assert c["jev"]["scored_evals"] == old["jev"]["evaluations"] == 164
    assert c["llm"]["scored_evals"] == old["llm"]["evaluations"] == 155
    assert c["jev"]["p50_ms_per_call"] == old["jev"]["p50_ms"]
    assert c["llm"]["p50_ms_per_call"] == old["llm"]["p50_ms_per_metric"]
    assert c["llm"]["p50_ms_per_row_sequential"] == old["llm"]["p50_ms_per_row_sequential"]
    assert round(c["jev"]["total_usd"], 6) == old["jev"]["total_usd"]
    assert round(c["llm"]["total_usd"], 6) == old["llm"]["total_usd"]
    # the old headline "Cost ratio" divided mismatched scopes: 164 Jev evals vs 155 LLM evals
    assert round(old["llm"]["usd_per_1k_evals"] / old["jev"]["usd_per_1k_evals"]) == 114
    assert c["scope"] == "partial"
    # independent recomputation of the like-for-like rows
    match = []
    for r in res:
        js = {m for m in MS if r["jev"].get(m) is not None}
        ls = {m for m, v in r["llm"].items() if v.get("score") is not None}
        if js == ls and js:
            match.append(r)
    m = c["matched"]
    assert m["rows"] == len(match) == 38 and m["unmatched_rows"] == 9
    assert m["unmatched"] == {"judges scored different metrics": 9}
    assert m["metric_evals"] == sum(sum(1 for k in MS if r["jev"].get(k) is not None) for r in match)
    ju = sum(r["jev_meta"]["usd"] for r in match)
    lu = sum(v["usd"] for r in match for v in r["llm"].values() if v.get("score") is not None)
    assert abs(m["jev_usd"] - ju) < 1e-12 and abs(m["llm_usd"] - lu) < 1e-12
    assert abs(m["cost_ratio"] - lu / ju) < 1e-9
    assert m["jev_p50_ms"] == med([r["jev_meta"]["latency_ms"] for r in match])
    assert m["llm_seq_p50_ms"] == pytest.approx(med([sum(v["latency_ms"] for v in r["llm"].values() if v.get("score") is not None) for r in match]), abs=0.11)


def test_equal_scope_all_rows_matched():
    rs = [row(i, {"intent_resolution": 4, "task_adherence": 3}, {"intent_resolution": L(), "task_adherence": L()}) for i in range(3)]
    c = cmp(rs)
    assert c["scope"] == "same" and c["matched"]["rows"] == 3 and c["matched"]["metric_evals"] == 6
    assert abs(c["matched"]["cost_ratio"] - 20) < 1e-9
    assert c["matched"]["llm_seq_p50_ms"] == 4000 and c["matched"]["jev_p50_ms"] == 300


def test_unequal_scope_and_failed_llm_call_excluded_not_zero():
    rs = [row(0, {"intent_resolution": 4}, {"intent_resolution": L()}),
          row(1, {"intent_resolution": 4, "groundedness": 3}, {"intent_resolution": L(), "groundedness": {"score": None, "error": "Timeout"}}),
          row(2, {"intent_resolution": 4, "groundedness": 3}, {"intent_resolution": L()})]
    c = cmp(rs)
    assert c["scope"] == "partial" and c["matched"]["rows"] == 1
    assert c["matched"]["unmatched"] == {"an LLM judge call failed": 1, "judges scored different metrics": 1}
    # the failed call had no usd/latency -> totals unknown, never silently 0
    assert c["llm"]["failed_calls"] == 1 and c["llm"]["missing_cost"] == 1
    assert c["llm"]["total_usd"] is None and c["llm"]["usd_per_1k_evals"] is None
    assert c["llm"]["known_usd"] == pytest.approx(3e-3)


def test_jev_row_failure():
    rs = [row(0, {}, {"intent_resolution": L()}, jmeta=False, err="Jev error 500"), row(1, {"intent_resolution": 5}, {"intent_resolution": L()})]
    c = cmp(rs)
    assert c["jev"]["failed_rows"] == 1 and c["jev"]["calls"] == 1
    assert c["matched"]["unmatched"] == {"Jev call failed": 1} and c["matched"]["rows"] == 1
    # a failed call may still have been billed: the full Jev total is unknown, not the sum of the rest
    assert c["jev"]["total_usd"] is None and c["jev"]["known_usd"] == pytest.approx(1e-4)


def test_no_baseline_shows_no_ratio():
    c = cmp([row(0, {"intent_resolution": 4}), row(1, {"task_adherence": 2})])
    assert c["scope"] == "no_baseline" and c["llm"] is None
    assert c["matched"]["rows"] == 0 and c["matched"]["cost_ratio"] is None
    assert c["jev"]["usd_per_1k_rows"] == pytest.approx(0.1)


def test_zero_and_missing_denominators():
    assert cmp([])["scope"] == "no_baseline"
    # zero-cost Jev (e.g. price 0) -> no division by zero, no ratio
    c = cmp([row(0, {"intent_resolution": 4}, {"intent_resolution": L()}, usd=0)])
    assert c["matched"]["rows"] == 1 and c["matched"]["cost_ratio"] is None
    # missing Jev cost -> row not matched, total unknown
    c = cmp([row(0, {"intent_resolution": 4}, {"intent_resolution": L()}, usd=None)])
    assert c["scope"] == "not_comparable" and c["matched"]["unmatched"] == {"cost not recorded": 1}
    assert c["jev"]["total_usd"] is None and c["jev"]["usd_per_1k_rows"] is None
    # LLM ran but every metric not applicable -> no calls, no per-1k figure
    c = cmp([row(0, {"intent_resolution": 4}, {"tool_call_accuracy": {"score": None, "result": "not_applicable"}})])
    assert c["llm"]["calls"] == 0 and c["llm"]["usd_per_1k_evals"] is None and c["llm"]["not_applicable"] == 1
    assert c["scope"] == "not_comparable"


def test_ui_wiring_old_ratio_card_removed_and_honest_copy():
    app = (ROOT / "app/static/app.js").read_text()
    html = (ROOT / "app/static/index.html").read_text()
    assert 'kpi("Cost ratio"' not in app and "Math.round(l.usd_per_1k_evals / j.usd_per_1k_evals)" not in app
    assert "bench_compare.js" in html and 'id="cmpCard"' in html
    fn = app[app.index("function renderCompare"):app.index("// ---------- disagreement review")]
    assert "not an invoice" in fn and "api(" not in fn and "fetch" not in fn and "S.rows" not in fn
    src = JS.read_text()
    assert "fetch" not in src and "localStorage" not in src


# ---- t_77ae45e4: per-case drilldown from the SAME projection ----
def test_real_replay_cases_membership_and_reasons():
    res = [json.loads(x) for x in (BENCH / "results.jsonl").read_text().splitlines() if x.strip()]
    c = cmp(res)
    K = c["cases"]
    assert len(K) == 47 and [k["pos"] for k in K] == list(range(47))
    inc = [k for k in K if k["status"] == "compared"]; exc = [k for k in K if k["status"] == "excluded"]
    assert len(inc) == c["matched"]["rows"] == 38 and len(exc) == 9
    assert {k["reason"] for k in exc} == {"judges scored different metrics"} and all(k["reason"] is None for k in inc)
    for k, r in zip(K, res):
        assert k["id"] == str(r["id"]) and k["id_unique"]
        assert set(k["jev_metrics"]) == {m for m in MS if r["jev"].get(m) is not None}
        assert set(k["llm_metrics"]) == {m for m, v in r["llm"].items() if v.get("score") is not None}
        assert (k["status"] == "compared") == (set(k["jev_metrics"]) == set(k["llm_metrics"]))
    # the 9 exclusions: Jev scored tool-call accuracy, LLM judge did not
    for k in exc:
        assert set(k["jev_metrics"]) - set(k["llm_metrics"]) == {"tool_call_accuracy"}
    # per-case sums reproduce the unchanged aggregate ratio
    assert abs(sum(k["jev_usd"] for k in inc) - c["matched"]["jev_usd"]) < 1e-12
    assert abs(sum(k["llm_usd"] for k in inc) - c["matched"]["llm_usd"]) < 1e-12


def test_cases_edge_reasons_unknown_not_zero():
    rs = [row(0, {"intent_resolution": 4}, {"intent_resolution": L()}),
          row(1, {"intent_resolution": 4}, {"intent_resolution": {"score": None, "error": "Timeout"}}),
          row(2, {}, {"intent_resolution": L()}, jmeta=False, err="Jev 500"),
          row(3, {"intent_resolution": 4}),
          row(4, {"intent_resolution": 4}, {"intent_resolution": L(usd=None)}),
          row(5, {"intent_resolution": 4}, {"intent_resolution": L(lat=None)})]
    K = cmp(rs)["cases"]
    assert [k["reason"] for k in K] == [None, "an LLM judge call failed", "Jev call failed", "no LLM judge result for this row", "cost not recorded", "latency not recorded"]
    assert K[1]["llm_failed_calls"] == 1 and K[1]["llm_usd"] is None and K[1]["llm_sum_ms"] is None
    assert K[2]["jev_usd"] is None and K[2]["jev_ms"] is None and K[2]["jev_metrics"] == []
    assert K[3]["llm_calls"] is None and K[3]["llm_usd"] is None
    assert K[4]["llm_usd"] is None and K[4]["llm_sum_ms"] == 2000
    assert K[5]["llm_sum_ms"] is None and K[5]["llm_usd"] == pytest.approx(1e-3)


def test_cases_duplicate_and_missing_ids_flagged():
    rs = [row(0, {"intent_resolution": 4}, {"intent_resolution": L()}), row(0, {"intent_resolution": 4}, {"intent_resolution": L()}),
          row(2, {"intent_resolution": 4}, {"intent_resolution": L()})]
    rs[2].pop("id")
    K = cmp(rs)["cases"]
    assert [k["id"] for k in K] == ["r0", "r0", None]
    assert [k["id_unique"] for k in K] == [False, False, False]
    assert [k["pos"] for k in K] == [0, 1, 2]
    # no-baseline run: every case excluded with an explicit reason, ratio still absent
    c = cmp([row(0, {"intent_resolution": 4})])
    assert c["cases"][0]["reason"] == "no LLM judge result for this row" and c["matched"]["cost_ratio"] is None


def test_ui_drilldown_binds_run_position_and_id_no_calls():
    app = (ROOT / "app/static/app.js").read_text()
    a = app[app.index("function cmpCaseLine"):app.index("function renderCompare")]
    assert "Show compared cases" in a and "Show excluded cases" in a and "<details" in a
    assert "api(" not in a and "fetch" not in a and "S.rows" not in a
    o = a[a.index("function openCmpCase"):]
    # stale run / id mismatch refuses instead of selecting another case
    assert "S.cmpRef !== S.results" in o and "String(x.id) !== id" in o and "String(src.id) !== id" in o and "showDetail(pos)" in o
