"""Disagreement review packet (app/static/review_packet.js): scope/counts, duplicate ids, exclusions,
post-run edits, escaping, no keys, and an independent recount against the retained real benchmark."""
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from jev_foundry_judge.stats import summarize  # noqa: E402

JS = ROOT / "app" / "static" / "review_packet.js"
M = "intent_resolution"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def build(summary, results, run_rows, view, metric):
    code = ("const {buildReviewPacket}=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
            "const a=JSON.parse(d);process.stdout.write(JSON.stringify(buildReviewPacket(a)))})")
    arg = {"summary": summary, "results": results, "runRows": run_rows, "view": view, "metric": metric,
           "generatedAt": "2026-09-27T00:00:00Z"}
    out = subprocess.run(["node", "-e", code, str(JS)], input=json.dumps(arg), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def res(i, jev, human, llm=None, **kw):
    r = {"id": i, "human": {M: human}, "jev": {M: jev},
         "jev_detail": {M: {"result": "pass" if (jev or 0) >= 3 else "fail", "confidence": 0.8, "reason": "r",
                            "checks": [{"check": "overall", "type": "score", "value": jev, "confidence": 0.9}]}}, **kw}
    if llm is not None:
        r["llm"] = {M: {"score": llm, "latency_ms": 1.0, "usd": 0.0}}
    return r


def snap(i, human, **kw):
    return {"id": i, "query": f"q-{i}", "response": [{"role": "assistant", "content": f"a-{i}"}], f"human_{M}": human, **kw}


def summ(results, th=3):
    s = summarize(results, th)
    s.update(version="vtest", at="2026-09-27T00:00:00Z")
    return s


def test_scope_counts_match_summary_and_metric_filter():
    R = [res("a", 4, 1, llm=4), res("b", 1, 5, llm=1), res("c", 4, 5, llm=2)]
    P = [snap("a", 1), snap("b", 5), snap("c", 5)]
    s = summ(R)
    p = build(s, R, P, "jev_vs_human", M)["packet"]
    c = s["disagreements"]["jev_vs_human"][M]
    assert p["counts"] == {"comparable_pairs": c["comparable"], "disagreeing_pairs": c["disagree"],
                           "rows_with_comparable_pairs": c["rows_comparable"], "rows_with_disagreements": c["rows_disagree"],
                           "excluded_pairs_by_reason": c["excluded"]}
    assert [x["id"] for x in p["pairs"]] == ["a", "b"] and len(p["rows"]) == 2
    assert p["filter"] == {"comparison": "jev_vs_human", "compared": ["jev", "human"], "metric": M, "metrics_in_scope": [M]}
    assert p["run"]["threshold"] == 3 and p["run"]["app_version"] == "vtest" and p["run"]["rows_in_run"] == 3
    q = build(s, R, P, "jev_vs_llm", "all")["packet"]
    assert [x["id"] for x in q["pairs"]] == ["c"] and q["pairs"][0]["compared"]["llm"] == {"score": 2, "pass": False}
    assert q["pairs"][0]["jev_detail"]["checks"][0]["check"] == "overall"
    other = build(s, R, P, "jev_vs_human", "groundedness")
    assert other["ok"] is False and "No comparable" in other["reason"]


def test_duplicate_ids_bound_by_position():
    R = [res("dup", 4, 1), res("dup", 4, 5), res("dup", 1, 5)]
    P = [snap("dup", 1, context="c0"), snap("dup", 5, context="c1"), snap("dup", 5, context="c2")]
    p = build(summ(R), R, P, "jev_vs_human", M)["packet"]
    assert [x["row_index"] for x in p["pairs"]] == [0, 2]
    assert [x["trace"]["context"] for x in p["rows"]] == ["c0", "c2"]


def test_missing_na_error_nonfinite_excluded_not_listed():
    R = [res("miss", 1, None), res("na", None, 1), {"id": "err", "human": {M: 1}, "error": "Jev error 500"},
         res("ok", 4, 1)]
    R[1]["jev_detail"][M]["result"] = "not_applicable"
    P = [snap(r["id"], 1) for r in R]
    s = summ(R)
    p = build(s, R, P, "jev_vs_human", M)["packet"]
    assert [x["id"] for x in p["pairs"]] == ["ok"]
    assert p["counts"]["excluded_pairs_by_reason"] == {"no human score": 1, "no jev score (not applicable)": 1, "row error": 1}
    # no comparable at all -> honest refusal, not an empty success file
    E = [res("x", None, None)]
    r = build(summ(E), E, [snap("x", None)], "jev_vs_human", "all")
    assert r["ok"] is False and "No comparable" in r["reason"]
    # comparable but zero disagreements -> packet says so explicitly
    Z = [res("z", 4, 5)]
    z = build(summ(Z), Z, [snap("z", 5)], "jev_vs_human", M)["packet"]
    assert z["pairs"] == [] and z["status"] == "no disagreements for this filter"


def test_post_run_edits_do_not_leak_and_tampering_refused():
    R = [res("a", 4, 1)]
    P = [snap("a", 1)]
    s = summ(R)
    edited_current_dataset = [snap("a", 5, query="EDITED")]  # noqa: F841 — the builder never sees it
    p = build(s, R, P, "jev_vs_human", M)["packet"]
    assert p["rows"][0]["trace"]["query"] == "q-a"
    assert p["pairs"][0]["human_label_provenance"]["value_in_run_snapshot"] == 1
    assert p["pairs"][0]["human_label_provenance"]["matches_stored_result"] is True
    # results changed after the summary was computed -> refuse instead of exporting a mismatch
    R2 = [res("a", 4, 4)]
    assert build(s, R2, P, "jev_vs_human", M)["ok"] is False
    # snapshot missing / id mismatch -> refuse rather than export without the judged trace
    assert build(s, R, [snap("zz", 1)], "jev_vs_human", M)["ok"] is False
    assert build(s, R, [], "jev_vs_human", M)["ok"] is False
    # CSV-uploaded label "1" (string) vs stored number 1 -> provenance still matches
    assert build(s, R, [snap("a", "1")], "jev_vs_human", M)["packet"]["pairs"][0]["human_label_provenance"]["matches_stored_result"] is True
    # summary counts tampered -> refuse
    s2 = json.loads(json.dumps(s)); s2["disagreements"]["jev_vs_human"][M]["disagree"] = 2
    assert build(s2, R, P, "jev_vs_human", M)["ok"] is False


def test_escaping_and_no_key_material():
    nasty = '</script><img src=x onerror=alert(1)> "quote" \u2028 \\ ,\n'
    R = [res(nasty, 4, 1)]
    P = [snap(nasty, 1, context=nasty)]
    r = build(summ(R), R, P, "jev_vs_human", M)
    text = json.dumps(r["packet"])
    back = json.loads(text)
    assert back["rows"][0]["id"] == nasty and back["rows"][0]["trace"]["context"] == nasty
    assert "disclosure" in back and "trace text" in back["disclosure"]
    low = text.lower()
    assert "x-jev-key" not in low and "api_key" not in low and "sk-" not in low
    src = JS.read_text()
    assert "fetch(" not in src and "XMLHttpRequest" not in src and "S.key" not in src and "localStorage" not in src


def test_existing_exports_unchanged():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    for s in ['$("#exDataJ").onclick = () => download(`dataset-${stamp()}.jsonl`, toJSONL(S.rows));',
              '$("#exResJ").onclick = () => download(`results-${stamp()}.jsonl`, toJSONL(flatResults()));',
              '$("#exSum").onclick = () => download(`benchmark-${stamp()}.json`, JSON.stringify(S.summary, null, 2));']:
        assert s in js
    assert "runRows: S.runRows" in js and "rows: S.rows" not in js.split("buildReviewPacket(")[1][:200]


def test_independent_recount_real_benchmark_packet():
    R = [json.loads(l) for l in (ROOT / "benchmark/results/results.jsonl").read_text().splitlines() if l.strip()]
    D = [json.loads(l) for l in (ROOT / "benchmark/results/dataset.jsonl").read_text().splitlines() if l.strip()]
    s = summ(R)
    fin = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    for view, get_b in (("jev_vs_human", lambda r, m: (r.get("human") or {}).get(m)),
                        ("jev_vs_llm", lambda r, m: ((r.get("llm") or {}).get(m) or {}).get("score"))):
        for metric in list(s["metrics"]) + ["all"]:
            ms = list(s["metrics"]) if metric == "all" else [metric]
            exp = [(i, m) for i, r in enumerate(R) for m in ms
                   if fin((r.get("jev") or {}).get(m)) and fin(get_b(r, m)) and ((r["jev"][m] >= 3) != (get_b(r, m) >= 3))]
            comp = sum(1 for r in R for m in ms if fin((r.get("jev") or {}).get(m)) and fin(get_b(r, m)))
            out = build(s, R, D, view, metric)
            p = out["packet"]
            assert [(x["row_index"], x["metric"]) for x in p["pairs"]] == exp
            assert p["counts"]["comparable_pairs"] == comp and p["counts"]["disagreeing_pairs"] == len(exp)
            assert p["counts"]["rows_with_disagreements"] == len({i for i, _ in exp}) == len(p["rows"])
            for row in p["rows"]:
                assert row["trace"]["query"] == D[row["row_index"]]["query"]
                assert row["trace"]["response"] == D[row["row_index"]]["response"]
