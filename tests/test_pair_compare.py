"""Original vs variant pairing (app/static/pair_compare.js): exact provenance binding within one frozen run,
missing = unknown (never 0), ambiguous/missing sources excluded with reasons, and a replay over the
retained REAL run-2 results from t_26ee87dc."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "app" / "static" / "pair_compare.js"
PARENT = ROOT / "workspace" / "deliverables" / "t_26ee87dc"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
TA = "task_adherence"


def pairs(results, run_rows):
    code = ("const {buildPairs}=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
            "process.stdout.write(JSON.stringify(buildPairs(JSON.parse(d))))})")
    out = subprocess.run(["node", "-e", code, str(JS)], input=json.dumps({"results": results, "runRows": run_rows}),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def row(i, src=None, **kw):
    r = {"id": i, "query": f"q-{i}", "response": f"a-{i}", **kw}
    if src is not None:
        r["source"] = "user-authored"
        r["derived_from"] = {"id": src}
    return r


def res(i, jev=None, llm=None, human=None):
    r = {"id": i, "jev": {TA: jev} if jev is not None else {}, "human": {TA: human} if human is not None else {}}
    if llm is not None:
        r["llm"] = {TA: {"score": llm}}
    return r


def test_basic_pair_signed_delta_and_unknown():
    rr = [row("a"), row("a-v", "a"), row("c")]
    P = pairs([res("a", 4.27, 5, 5), res("a-v", 2.69, 1), res("c", 3.0)], rr)
    assert P["ok"] and len(P["pairs"]) == 1
    p = P["pairs"][0]
    assert (p["original_id"], p["variant_id"], p["original_idx"], p["variant_idx"]) == ("a", "a-v", 0, 1)
    t = p["metrics"][TA]
    assert t["jev"] == {"original": 4.27, "variant": 2.69, "delta": -1.58}
    assert t["llm"]["delta"] == -4
    assert t["human"] == {"original": 5, "variant": None, "delta": None}  # unknown, not 0
    assert p["metrics"]["groundedness"]["jev"]["delta"] is None
    assert P["totals"][TA]["human"] == {"n": 0, "of": 1}
    assert P["totals"][TA]["jev"] == {"n": 1, "of": 1}


def test_source_removed_duplicate_and_nested():
    rr = [row("v1", "gone"), row("d"), row("d"), row("v2", "d"), row("o"), row("v3", "o"), row("v4", "v3")]
    rs = [res(r["id"], 3) for r in rr]
    P = pairs(rs, rr)
    got = {e["variant_id"]: e["reason"] for e in P["excluded"]}
    assert "not in this run" in got["v1"] and "ambiguous" in got["v2"]
    ids = [(p["original_id"], p["variant_id"], p["nested"]) for p in P["pairs"]]
    assert ids == [("o", "v3", False), ("v3", "v4", True)]


def test_not_inferred_from_similar_ids_or_non_authored():
    rr = [row("x"), row("x-variant"), {**row("y"), "derived_from": {"id": "x"}}]  # no source: user-authored
    assert pairs([res(r["id"], 3) for r in rr], rr)["pairs"] == []


def test_misbound_snapshot_refused():
    rr = [row("a"), row("a-v", "a")]
    assert not pairs([res("a", 3)], rr)["ok"]
    P = pairs([res("a", 3), res("zzz", 3)], rr)
    assert P["pairs"] == [] and "not bound" in P["excluded"][0]["reason"]


def test_duplicate_variant_id_excluded():
    rr = [row("a"), row("v", "a"), row("v", "a")]
    P = pairs([res(r["id"], 3) for r in rr], rr)
    assert P["pairs"] == [] and len(P["excluded"]) == 2


@pytest.mark.skipif(not (PARENT / "live-run2-results.jsonl").exists(), reason="retained results missing")
def test_replay_retained_real_run2():
    """No-spend REPLAY of t_26ee87dc run 2 (real results) over its exact reimported dataset."""
    flat = [json.loads(l) for l in (PARENT / "live-run2-results.jsonl").read_text().splitlines() if l.strip()]
    ds = [json.loads(l) for l in (PARENT / "live-variant-dataset.jsonl").read_text().splitlines() if l.strip()]
    assert [r["id"] for r in ds] == [r["id"] for r in flat]
    ms = ["intent_resolution", TA, "tool_call_accuracy", "groundedness"]
    rs = [{"id": f["id"], "jev": {m: f.get(f"jev_{m}") for m in ms if f.get(f"jev_{m}") is not None},
           "llm": {m: {"score": f.get(f"llm_{m}")} for m in ms if f.get(f"llm_{m}") is not None},
           "human": {m: f.get(f"human_{m}") for m in ms if f.get(f"human_{m}") is not None}} for f in flat]
    P = pairs(rs, ds)
    by = {p["variant_id"]: p for p in P["pairs"]}
    c = by["contoso-refund-window-variant"]["metrics"]
    assert c["groundedness"]["jev"] == {"original": 4.37, "variant": 1.06, "delta": -3.31}
    assert c[TA]["jev"]["delta"] == round(2.69 - 4.27, 2)
    assert c[TA]["human"]["original"] == 5 and c[TA]["human"]["variant"] == 1
    s = by["sup-01-variant"]["metrics"]
    assert s["groundedness"]["jev"]["delta"] == round(1.10 - 3.98, 2)
    assert s[TA]["human"]["variant"] is None and s[TA]["human"]["delta"] is None


def test_one_original_many_variants_and_numeric_id():
    rr = [row(7), row("7-a", 7), row("7-b", "7")]
    P = pairs([res(7, 4), res("7-a", 2), res("7-b", 5)], rr)
    assert [(p["variant_id"], p["metrics"][TA]["jev"]["delta"]) for p in P["pairs"]] == [("7-a", -2), ("7-b", 1)]
