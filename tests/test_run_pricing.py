"""t_e99fa8ea: comparison/brief/package pricing is bound to the prices RECORDED for the run (S.runCfg), never to the
current mutable app config. Uses the retained REAL completed BYO-key run frozen by t_389b5628 (key-1440) and the
labelled REPLAY of the retained real47 benchmark (no recorded config)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")

JS = """const {buildBenchCompare,runPricing}=require(process.argv[1]);const {buildBenchBrief}=require(process.argv[2]);let d='';
process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const out=a.cases.map(k=>{
 // legacy path (pre-fix): pricing read from the CURRENT app config
 const pricing=k.legacy?{jev_usd_per_mtok_input:k.cfg.jev_usd_per_mtok_input??null,llm_usd_per_mtok_in:k.cfg.baseline?.usd_per_mtok_in??null,llm_usd_per_mtok_out:k.cfg.baseline?.usd_per_mtok_out??null}:runPricing(a.runCfg);
 const c=buildBenchCompare(a.results,{pricing});
 return {c,t:buildBenchBrief({compare:c,summary:a.summary,meta:{app_version:k.cfg.version,generated_at:'T'}})};});
process.stdout.write(JSON.stringify(out))})"""


def run(state, cases):
    o = subprocess.run(["node", "-e", JS, str(ST / "bench_compare.js"), str(ST / "bench_brief.js")],
                       input=json.dumps({**state, "cases": cases}), capture_output=True, text=True, check=True)
    return json.loads(o.stdout)


def frozen(name):
    if name == "key-1440":   # retained REAL BYO-key run (t_389b5628), committed as a fixture
        return json.loads((ROOT / "tests" / "fixtures" / "real-run-t389-key1440-frozen-state.json").read_text())
    # labelled REPLAY of the retained real47 benchmark: no run config was recorded
    res = [json.loads(x) for x in (ROOT / "benchmark" / "results" / "results.jsonl").read_text().splitlines() if x.strip()]
    from jev_foundry_judge.stats import summarize
    s = summarize(res, 3); s.update({"version": "replay-recorded", "at": "unknown", "baseline_label": "LLM judge (replay)"})
    return {"results": res, "summary": s, "runCfg": None}


CFG_A = {"version": "v-now", "jev_usd_per_mtok_input": 0.042, "baseline": {"usd_per_mtok_in": 0.75, "usd_per_mtok_out": 4.5}}
CFG_B = {"version": "v-later", "jev_usd_per_mtok_input": 0.5, "baseline": {"usd_per_mtok_in": 9.0, "usd_per_mtok_out": 99.0}}


def strip_gen(t):
    return "\n".join(x for x in t.splitlines() if not x.startswith("- Brief generated:"))


def test_real_run_legacy_drifts_fixed_stable():
    s = frozen("key-1440")
    rc = s["runCfg"]
    assert rc and rc["jev_usd_per_mtok_input"] is not None
    la, lb, fa, fb = run(s, [{"legacy": True, "cfg": CFG_A}, {"legacy": True, "cfg": CFG_B},
                             {"cfg": CFG_A}, {"cfg": CFG_B}])
    # reproduce the defect: pre-fix brief text changes when only the current config changes
    assert strip_gen(la["t"]) != strip_gen(lb["t"]) and "$0.5 per 1M" in lb["t"]
    # fixed: identical economic content under the same change; only the labelled export version differs
    assert strip_gen(fa["t"]) == strip_gen(fb["t"])
    assert fa["c"] == fb["c"]
    assert fa["c"]["pricing"] == {"source": "recorded_at_run_start", "jev_usd_per_mtok_input": rc["jev_usd_per_mtok_input"],
                                  "llm_usd_per_mtok_in": rc["baseline_usd_per_mtok_in"], "llm_usd_per_mtok_out": rc["baseline_usd_per_mtok_out"]}
    assert "recorded at run start" in fa["t"] and f"Jev ${rc['jev_usd_per_mtok_input']} per 1M" in fa["t"]
    assert "current app v-now" in fa["t"] and "current app v-later" in fb["t"]
    assert f"App version recorded with the run: {s['summary']['version']}" in fb["t"]
    # stored measured row costs are used as recorded, never repriced
    assert fa["c"]["jev"]["known_usd"] == pytest.approx(sum(r["jev_meta"]["usd"] for r in s["results"]))


def test_replay_without_recorded_prices_is_unknown():
    s = frozen("replay-real47")
    assert s["runCfg"] is None
    fa, fb = run(s, [{"cfg": CFG_A}, {"cfg": CFG_B}])
    P = fa["c"]["pricing"]
    assert P["source"] == "not_recorded" and P["jev_usd_per_mtok_input"] is None and P["llm_usd_per_mtok_in"] is None
    assert "Pricing: not recorded for this run" in fa["t"]
    for t in (fa["t"], fb["t"]):
        assert "$0.042" not in t and "$0.75" not in t and "$0.5 per" not in t and "$9.0" not in t
    assert strip_gen(fa["t"]) == strip_gen(fb["t"])
    # the ratio comes only from recorded row costs (unchanged by pricing); it is not fabricated from prices
    assert fa["c"]["matched"] == fb["c"]["matched"]


def test_run_pricing_partial_and_bad_values():
    code = ("const {runPricing}=require(process.argv[1]);process.stdout.write(JSON.stringify([runPricing(null),runPricing({}),"
            "runPricing({jev_usd_per_mtok_input:'0.04',baseline_usd_per_mtok_in:NaN,baseline_usd_per_mtok_out:4.5})]))")
    a, b, c = json.loads(subprocess.run(["node", "-e", code, str(ST / "bench_compare.js")], capture_output=True, text=True, check=True).stdout)
    assert a["source"] == "not_recorded" and b["source"] == "recorded_at_run_start"
    assert b["jev_usd_per_mtok_input"] is None
    assert c["jev_usd_per_mtok_input"] is None and c["llm_usd_per_mtok_in"] is None and c["llm_usd_per_mtok_out"] == 4.5


def test_app_uses_run_pricing_only():
    src = (ST / "app.js").read_text()
    assert src.count("pricing: runPricing(S.runCfg)") == 2
    assert "pricing: { jev_usd_per_mtok_input: S.cfg" not in src
