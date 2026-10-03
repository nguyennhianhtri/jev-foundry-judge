"""t_10def3c9: paired Jev vs comparator (human label / stored Foundry LLM judge) distribution over ONE completed run
(app/static/score_dist.js pairedDist). Fixtures labelled SYNTHETIC except the retained real run
(tests/fixtures/real-run-t389-key1440-frozen-state.json: real Jev + real stored Foundry LLM-judge scores, authored labels)."""
import json, math, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const D=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);"
        "const before=JSON.stringify(a.results);const o={};"
        "o.pd=D.pairedDist(a.results,a.m,a.c,{metrics:a.metrics,threshold:3});"
        "o.bin=a.bin?D.pairedBinCases(o.pd,a.bin):null;"
        "o.jevOnly=D.scoreDist(a.results,a.m,{metrics:a.metrics,threshold:3});"
        "o.unchanged=JSON.stringify(a.results)===before;process.stdout.write(JSON.stringify(o))})")
GR, IR = "groundedness", "intent_resolution"


def run(results, m, c, metrics=None, bin=None):
    out = subprocess.run(["node", "-e", CODE, str(ST / "score_dist.js")], input=json.dumps(
        {"results": results, "m": m, "c": c, "metrics": metrics, "bin": bin}), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def n(bins):
    return [b["n"] for b in bins]


def test_only_valid_pairs_counted_boundaries_identical_bins():
    # SYNTHETIC: exact edges on both sides
    R = [{"id": 1, "jev": {GR: 2}, "human": {GR: 1}}, {"id": "1", "jev": {GR: 1.999}, "human": {GR: 2}},
         {"id": 3, "jev": {GR: 5}, "human": {GR: 3}}, {"id": 4, "jev": {GR: 3.9999}, "human": {GR: 4.5}}]
    o = run(R, GR, "human", [GR])
    pd = o["pd"]
    assert pd["available"] and pd["paired"] == 4 and pd["excluded_n"] == 0
    assert n(pd["jev_bins"]) == [1, 1, 1, 1] and n(pd["cmp_bins"]) == [1, 1, 1, 1]
    assert [b["key"] for b in pd["jev_bins"]] == [b["key"] for b in pd["cmp_bins"]]
    # same histogram, yet no case sits in the same bin for both judges: similarity != agreement
    assert all(p["jevBin"] != p["cmpBin"] for p in pd["pairs"])
    assert o["unchanged"]


def test_exclusions_by_reason_never_zero_or_imputed():
    # SYNTHETIC: every exclusion path
    R = [{"id": "ok", "jev": {GR: 4.2}, "human": {GR: 4}, "llm": {GR: {"score": 5}}},
         {"id": "jna", "jev": {GR: None}, "jev_detail": {GR: {"result": "not_applicable"}}, "human": {GR: 3}},
         {"id": "jerr", "error": "Jev error 500", "jev": {}, "human": {GR: 3}},
         {"id": "nolab", "jev": {GR: 3.1}, "human": {GR: None}},
         {"id": "zero", "jev": {GR: 3.1}, "human": {GR: 0}},
         {"id": "str", "jev": {GR: 3.1}, "human": {GR: "4"}},
         {"id": "bool", "jev": {GR: 3.1}, "human": {GR: True}},
         {"id": "nohuman", "jev": {GR: 3.1}}]
    pd = run(R, GR, "human", [GR])["pd"]
    assert pd["paired"] == 1 and pd["rows"] == 8 and pd["excluded_n"] == 7 and pd["jev_scored_all"] == 6
    assert pd["excluded"] == {"Jev: not applicable": 1, "Jev: row error": 1, "no human label": 2,
                              "human label not a 1–5 number": 3}
    L = [{"id": "ok", "jev": {GR: 4.2}, "llm": {GR: {"score": 5}}},
         {"id": "lna", "jev": {GR: 4.2}, "llm": {GR: {"score": None, "result": "not_applicable"}}},
         {"id": "lerr", "jev": {GR: 4.2}, "llm": {GR: {"score": None, "error": "HttpResponseError"}}},
         {"id": "lnometric", "jev": {GR: 4.2}, "llm": {}},
         {"id": "lnorow", "jev": {GR: 4.2}},
         {"id": "l0", "jev": {GR: 4.2}, "llm": {GR: {"score": 0}}},
         {"id": "lerrnum", "jev": {GR: 4.2}, "llm": {GR: {"score": 4, "error": "Timeout"}}},
         {"id": "lnanum", "jev": {GR: 4.2}, "llm": {GR: {"score": 3, "result": "not_applicable"}}}]
    pd = run(L, GR, "llm", [GR])["pd"]
    assert pd["paired"] == 1 and sum(n(pd["cmp_bins"])) == 1
    assert pd["excluded"] == {"LLM judge: not applicable": 2, "LLM judge error": 2, "LLM judge not run for this metric": 1,
                              "LLM judge not run for this row": 1, "LLM judge score outside 1–5": 1}


def test_missing_comparator_is_unavailable_not_zero():
    R = [{"id": 1, "jev": {GR: 4}, "human": {GR: None}}, {"id": 2, "jev": {GR: 2}}]  # SYNTHETIC
    for c in ("human", "llm"):
        pd = run(R, GR, c, [GR])["pd"]
        assert not pd["available"] and pd["paired"] == 0 and n(pd["cmp_bins"]) == [0, 0, 0, 0]
    assert not run(R, GR, "bogus", [GR])["pd"]["available"]
    assert not run(R, IR, "human", [GR])["pd"]["in_run"]


def test_bin_cases_typed_ids_both_scores():
    R = [{"id": 7, "jev": {GR: 2}, "human": {GR: 4}}, {"id": "7", "jev": {GR: 4.5}, "human": {GR: 2}},
         {"id": 8, "jev": {GR: 4.1}, "human": {GR: 5}}]  # SYNTHETIC
    b = run(R, GR, "human", [GR], bin="2-3")["bin"]
    assert [(x["id"], x["jev"], x["cmp"], x["jevIn"], x["cmpIn"]) for x in b] == [(7, 2, 4, True, False), ("7", 4.5, 2, False, True)]


def _bin(v):
    return 0 if 1 <= v < 2 else 1 if v < 3 else 2 if v < 4 else 3 if v <= 5 else None


def test_real_retained_run_independent_recount_both_comparators():
    st = json.loads((ROOT / "tests/fixtures/real-run-t389-key1440-frozen-state.json").read_text())
    ok = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and 1 <= v <= 5
    for m in st["runCfg"]["metrics"]:
        for c in ("human", "llm"):
            exp_j, exp_c, ids = [0] * 4, [0] * 4, []
            for x in st["results"]:
                j = (x.get("jev") or {}).get(m)
                v = (x.get("human") or {}).get(m) if c == "human" else ((x.get("llm") or {}).get(m) or {}).get("score")
                if ok(j) and ok(v):
                    exp_j[_bin(j)] += 1; exp_c[_bin(v)] += 1; ids.append(x["id"])
            pd = run(st["results"], m, c, st["runCfg"]["metrics"])["pd"]
            assert n(pd["jev_bins"]) == exp_j and n(pd["cmp_bins"]) == exp_c, (m, c)
            assert [p["id"] for p in pd["pairs"]] == ids and pd["paired"] + pd["excluded_n"] == len(st["results"])
            assert pd["available"] == bool(ids)
    # tool_call_accuracy: no case has tools -> both comparators honestly unavailable
    assert not run(st["results"], "tool_call_accuracy", "llm", st["runCfg"]["metrics"])["pd"]["available"]


def _pts(results, m, c, metrics):
    code = ("const D=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);"
            "const pd=D.pairedDist(a.results,a.m,a.c,{metrics:a.metrics});process.stdout.write(JSON.stringify({pd,pp:D.pairPoints(pd)}))})")
    out = subprocess.run(["node", "-e", code, str(ST / "score_dist.js")], input=json.dumps(
        {"results": results, "m": m, "c": c, "metrics": metrics}), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_pair_points_same_projection_grouped_not_jittered():
    # SYNTHETIC: identical histograms, pairs reveal the disagreement; duplicates grouped with every typed id
    R = [{"id": 1, "jev": {GR: 4.5}, "human": {GR: 1}}, {"id": "1", "jev": {GR: 1.5}, "human": {GR: 5}},
         {"id": "a", "jev": {GR: 3}, "human": {GR: 3}}, {"id": "b", "jev": {GR: 3}, "human": {GR: 3}},
         {"id": "nolab", "jev": {GR: 2}}]
    o = _pts(R, GR, "human", [GR]); pp = o["pp"]
    assert pp["paired"] == o["pd"]["paired"] == 4 and sum(g["n"] for g in pp["points"]) == 4
    assert [(g["jev"], g["cmp"], g["n"]) for g in pp["points"]] == [(4.5, 1, 1), (1.5, 5, 1), (3, 3, 2)]  # |diff| tie -> run order
    assert [i["id"] for i in pp["points"][2]["items"]] == ["a", "b"] and pp["points"][1]["items"][0]["id"] == "1" and pp["points"][0]["items"][0]["id"] == 1
    assert pp["equal"] == 2 and pp["cmp_higher"] == 1 and pp["cmp_lower"] == 1 and pp["other_bin"] == 2
    assert pp["max_abs_diff"] == 3.5
    ids = {json.dumps(i["id"]) for g in pp["points"] for i in g["items"]}
    assert ids == {json.dumps(p["id"]) for p in o["pd"]["pairs"]}


def test_pair_points_real_run_independent_recount():
    st = json.loads((ROOT / "tests/fixtures/real-run-t389-key1440-frozen-state.json").read_text())
    ok = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and 1 <= v <= 5
    for m in st["runCfg"]["metrics"]:
        for c in ("human", "llm"):
            exp = {}
            for x in st["results"]:
                a = (x.get("jev") or {}).get(m)
                lo = (x.get("llm") or {}).get(m) or {}
                b = (x.get("human") or {}).get(m) if c == "human" else lo.get("score")
                if c == "llm" and (lo.get("error") or lo.get("result") == "not_applicable"):
                    continue
                if ok(a) and ok(b):
                    exp.setdefault((a, b), []).append(x["id"])
            pp = _pts(st["results"], m, c, st["runCfg"]["metrics"])["pp"]
            got = {(g["jev"], g["cmp"]): [i["id"] for i in g["items"]] for g in pp["points"]}
            assert got == exp, (m, c)
