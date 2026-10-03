"""t_51ac76a3: benchmark brief (.md) = text rendering of the SAME bench_compare projection + frozen summary.
REPLAY of the retained REAL 47-row benchmark (38 compared / 9 excluded), plus null / partial / no-baseline /
not-comparable / missing-cost cases. Figures are cross-checked against an independent Python recount."""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from jev_foundry_judge.stats import summarize

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
BENCH = ROOT / "benchmark" / "results"
MS = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
PRICING = {"jev_usd_per_mtok_input": 0.042, "llm_usd_per_mtok_in": 0.75, "llm_usd_per_mtok_out": 4.5}


def brief(results, summary, meta=None):
    code = ("const {buildBenchCompare}=require(process.argv[1]);const {buildBenchBrief}=require(process.argv[2]);let d='';"
            "process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const c=buildBenchCompare(a.r,{pricing:a.p});"
            "process.stdout.write(JSON.stringify({c,t:buildBenchBrief({compare:c,summary:a.s,meta:a.m})}))})")
    out = subprocess.run(["node", "-e", code, str(ST / "bench_compare.js"), str(ST / "bench_brief.js")],
                         input=json.dumps({"r": results, "s": summary, "m": meta or {}, "p": PRICING}),
                         capture_output=True, text=True, check=True)
    o = json.loads(out.stdout)
    return o["c"], o["t"]


def real():
    return [json.loads(x) for x in (BENCH / "results.jsonl").read_text().splitlines() if x.strip()]


def row(i, llm=None, usd=1e-4, lat=300.0, jev=None, err=None, meta=True):
    r = {"id": f"r{i}", "human": {"intent_resolution": 4}, "jev": jev if jev is not None else {"intent_resolution": 4.0}, "jev_detail": {}}
    if meta:
        r["jev_meta"] = {"latency_ms": lat, "usd": usd, "input_tokens": 1000}
    if err:
        r["error"] = err
    if llm is not None:
        r["llm"] = llm
    return r


def L(score=4.0, usd: float | None = 1e-3, lat=2000.0):
    d = {"score": score, "latency_ms": lat, "usd": usd, "result": "pass"}
    if usd is None:
        del d["usd"]   # cost not recorded
    return d


def summ(res, **kw):
    s = summarize(res, 3)
    s.update({"version": "v-test", "at": "2026-09-27T00:00:00Z", "baseline_label": "LLM judge (test)"}, **kw)
    return s


def test_real47_replay_brief_matches_projection_and_independent_recount():
    res = real()
    s = summarize(res, 3)            # frozen replay: no version recorded with the retained results
    c, t = brief(res, s, {"app_version": "v-test", "generated_at": "2026-09-27T05:00:00Z"})
    m = c["matched"]
    assert m["rows"] == 38 and m["unmatched_rows"] == 9
    assert "Compared rows: **38 of 47**" in t
    assert "Excluded rows: 9 (judges scored different metrics: 9)" in t
    assert "Scope: **partial**" in t
    # independent recount of the ratio from raw results
    match = [r for r in res if {k for k in MS if r["jev"].get(k) is not None} == {k for k, v in r["llm"].items() if v.get("score") is not None}]
    ju = sum(r["jev_meta"]["usd"] for r in match)
    lu = sum(v["usd"] for r in match for v in r["llm"].values() if v.get("score") is not None)
    assert len(match) == 38 and f"**{round(lu / ju)}×**" in t
    assert "App version recorded with the run: unknown" in t and "Rows in the run: 47" in t
    # agreement exactly from the frozen summary with its n
    o = s["overall"]["jev_vs_human"]
    assert f"{o['pass_fail_agreement'] * 100:.1f}% pass/fail agreement, MAE {o['mae']} (n = {o['n']} score pairs)" in t
    tca = s["metrics"]["tool_call_accuracy"]["llm_vs_human"]
    assert f"(n = {tca['n']} score pairs)" in t
    # labelled per-call vs summed per-metric latency
    assert "one call scores all metrics of the row" in t and "sum of its per-metric call times" in t
    # no trace text / prompts: none of the dataset's queries or responses appear
    ds = [json.loads(x) for x in (BENCH / "dataset.jsonl").read_text().splitlines() if x.strip()]
    for d in ds:
        for f in ("query", "response"):
            v = d.get(f)
            v = v if isinstance(v, str) else json.dumps(v)
            assert v[:40] not in t
    assert "synthetic labels written by the dataset author" in t and "not a general performance claim" in t
    assert not re.search(r"confiden(ce|t) interval of|statistically significant|p ?<", t)


def test_no_completed_run_gives_no_brief():
    assert brief([], summarize([], 3))[1] is None
    code = "const {buildBenchBrief}=require(process.argv[1]);process.stdout.write(JSON.stringify(buildBenchBrief({})))"
    out = subprocess.run(["node", "-e", code, str(ST / "bench_brief.js")], capture_output=True, text=True, check=True)
    assert out.stdout == "null"


def test_no_baseline_has_no_ratio_and_marks_llm_not_run():
    res = [row(i) for i in range(3)]
    c, t = brief(res, summ(res, baseline_label=None))
    assert c["scope"] == "no_baseline" and "Scope: **no baseline**" in t and "no cost ratio" in t
    assert "×" not in t.split("## Full run")[0].replace("no cost ratio", "")
    assert "| not run |" in t and "LLM judge: not run in this run" in t


def test_same_scope_all_matched_ratio():
    res = [row(i, {"intent_resolution": L()}) for i in range(4)]
    c, t = brief(res, summ(res))
    assert c["scope"] == "same" and "Compared rows: **4 of 4**" in t and "Excluded rows: 0 (none)" in t
    assert "**10×**" in t and "App version recorded with the run: v-test" in t


def test_not_comparable_and_missing_cost_is_unknown_not_zero():
    res = [row(0, {"task_adherence": L()}), row(1, {"intent_resolution": L(usd=None)})]
    c, t = brief(res, summ(res))
    assert c["scope"] == "not_comparable" and "Scope: **not comparable**" in t and "cost ratio is given" in t
    assert "Excluded rows: 2 of 2 (judges scored different metrics: 1; cost not recorded: 1)" in t
    assert re.search(r"\| Estimated cost, whole run \| \$0\.00020 \| unknown \(\$0\.00100 recorded; 1 call\(s\) without cost\)", t)


def test_partial_with_failed_jev_row():
    res = [row(0, {"intent_resolution": L()}), row(1, {"intent_resolution": L()}, err="boom", meta=False, jev={})]
    c, t = brief(res, summ(res))
    assert c["scope"] == "partial" and "Compared rows: **1 of 2**" in t and "Jev call failed: 1" in t and "; 1 failed" in t
    assert "unknown (" in t   # Jev total unknown because a row has no cost


def test_ui_wiring_and_no_second_metric_impl():
    js = (ST / "app.js").read_text()
    html = (ST / "index.html").read_text()
    assert 'id="exBrief"' in html and "Download benchmark brief (.md)" in html and "/static/bench_brief.js" in html
    assert html.index("bench_compare.js") < html.index("bench_brief.js") < html.index("app.js")
    assert "buildBenchBrief({ compare: c, summary: S.summary" in js and "buildBenchCompare(S.results" in js
    src = (ST / "bench_brief.js").read_text()
    assert "reduce(" not in src and "sort(" not in src   # formatting only; no aggregation of its own
    assert "S.key" not in js.split("function briefText")[1].split("$(\"#exBrief\")")[0]


def test_label_escaping_and_unknown_pricing():
    res = [row(0, {"intent_resolution": L()})]
    code = ("const {buildBenchCompare}=require(process.argv[1]);const {buildBenchBrief}=require(process.argv[2]);let d='';"
            "process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const c=buildBenchCompare(a.r,{});"
            "process.stdout.write(buildBenchBrief({compare:c,summary:a.s}))})")
    s = summ(res, baseline_label="[x](http://evil) <b>*y*</b>|z\nq")
    t = subprocess.run(["node", "-e", code, str(ST / "bench_compare.js"), str(ST / "bench_brief.js")],
                       input=json.dumps({"r": res, "s": s}), capture_output=True, text=True, check=True).stdout
    line = [x for x in t.splitlines() if x.startswith("- LLM judge:")][0]
    assert "\\[x\\]" in line and "<b>" not in line and "\\*y\\*" in line and "\\|" in line and "\n" not in line
    assert "Jev unknown per 1M" in t and "$unknown" not in t
