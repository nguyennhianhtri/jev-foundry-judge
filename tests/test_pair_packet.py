"""Pair comparison export (app/static/pair_packet.js): a projection of buildPairs over the frozen run only.
Checked independently against the retained REAL t_09e2ef4a raw results (REPLAY, no spend)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "app" / "static" / "pair_packet.js"
PAR = ROOT / "workspace" / "deliverables" / "t_09e2ef4a"
pytestmark = [pytest.mark.skipif(not shutil.which("node"), reason="node not installed"),
              pytest.mark.skipif(not (PAR / "live-run-raw-results.json").exists(), reason="retained real run results not in this checkout")]
MS = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]


def packet(summary, results, run_rows):
    code = ("const {buildPairPacket}=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
            "process.stdout.write(JSON.stringify(buildPairPacket(JSON.parse(d))))})")
    out = subprocess.run(["node", "-e", code, str(JS)],
                         input=json.dumps({"summary": summary, "results": results, "runRows": run_rows,
                                           "generatedAt": "2026-09-27T00:00:00Z"}),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def real():
    return (json.loads((PAR / "live-run-raw-results.json").read_text()),
            json.loads((PAR / "live-run-runrows.json").read_text()))


SUM = {"version": "REPLAY of t_09e2ef4a live run", "at": "2026-09-26T17:12:00Z", "llm": {"evaluations": 12}}


def test_real_replay_exact_scores_and_missingness():
    res, rr = real()
    r = packet(SUM, res, rr)
    assert r["ok"]
    k = r["packet"]
    assert k["counts"]["pairs"] == 1 and len(k["pairs"]) == 1
    p = k["pairs"][0]
    assert (p["original_id"], p["variant_id"]) == ("fab-bags", "fab-bags-variant")
    o, v = res[0], res[1]
    for m in MS:
        for j in ("jev", "llm", "human"):
            g = (lambda x: x.get("llm", {}).get(m, {}).get("score")) if j == "llm" else (lambda x: x.get(j, {}).get(m))
            a, b = g(o), g(v)
            c = p["scores"][m][j]
            assert c["original"] == a and c["variant"] == b
            assert c["delta"] == (round((b - a) * 100) / 100 if a is not None and b is not None else None)
    assert p["scores"]["groundedness"]["jev"]["delta"] == -3.87
    assert p["scores"]["task_adherence"]["human"] == {"original": 5, "variant": None, "delta": None}
    assert p["scores"]["tool_call_accuracy"]["jev"]["delta"] is None  # not applicable -> unknown, not 0
    assert k["counts"]["comparable_by_metric_and_judge"]["groundedness"]["human"] == {"n": 1, "of": 1}
    assert k["counts"]["comparable_by_metric_and_judge"]["intent_resolution"]["human"] == {"n": 0, "of": 1}
    assert [e["variant_id"] for e in k["excluded"]] == ["orphan-variant"]
    assert "not in this run" in k["excluded"][0]["reason"]
    assert {u["id"] for u in k["rows_not_in_a_pair"]} == {"tailspin-hours", "orphan-variant"}
    assert p["variant"]["provenance"]["derived_from"]["id"] == "fab-bags"
    assert "unlimited bags" in json.dumps(p["variant"]["trace"])
    assert p["variant"]["metrics"]["groundedness"]["jev_detail"]["checks"] == res[1]["jev_detail"]["groundedness"]["checks"]
    assert "not observed agent runs" in k["evidence_status"]
    s = json.dumps(k)
    assert "studio" not in s.lower() and "key" not in json.dumps(list(k.keys()))


def test_empty_and_unbound():
    assert packet(SUM, [], [])["ok"] is False
    res, rr = real()
    assert packet(SUM, res, rr[:2])["ok"] is False  # snapshot missing -> refused, never guessed
    rr2 = [dict(r, derived_from=None, source=None) for r in rr]
    k = packet(SUM, res, rr2)["packet"]
    assert k["counts"]["pairs"] == 0 and k["status"].startswith("no original")
    assert all(v["n"] == 0 and v["of"] == 0 for m in k["counts"]["comparable_by_metric_and_judge"].values() for v in m.values())
