"""Disagreement review: threshold, missing/NA/error/NaN exclusion, duplicate ids, run binding."""
import json
import math
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from jev_foundry_judge.foundry_run import to_app_results
from jev_foundry_judge.stats import disagreements, summarize

M = "intent_resolution"


def row(i, jev=None, human=None, llm=None, **kw):
    r = {"id": i, "human": {M: human}, "jev": {M: jev}, **kw}
    if llm is not None or "llm_none" in kw:
        r["llm"] = {M: {"score": llm}}
    return r


def test_threshold_boundary_uses_run_threshold():
    rs = [row("a", jev=3.0, human=2.9), row("b", jev=3.5, human=4)]
    d3 = disagreements(rs, 3)["jev_vs_human"][M]
    assert (d3["comparable"], d3["disagree"]) == (2, 1) and d3["items"][0]["id"] == "a"
    d4 = disagreements(rs, 4)["jev_vs_human"][M]
    assert d4["disagree"] == 1 and d4["items"][0]["id"] == "b"   # 3.5 fail vs 4 pass
    assert summarize(rs, 4)["threshold"] == 4


def test_missing_na_error_nan_never_fail_or_disagree():
    rs = [row("miss", jev=1.0, human=None),
          row("na", jev=None, human=1, jev_detail={M: {"result": "not_applicable"}}),
          {"id": "err", "human": {M: 1}, "error": "Jev error 500"},
          row("nan", jev=float("nan"), human=1),
          row("bool", jev=True, human=1),
          row("ok", jev=4.0, human=4)]
    d = disagreements(rs, 3)["jev_vs_human"]
    assert d[M]["comparable"] == 1 and d[M]["disagree"] == 0 and d[M]["items"] == []
    ex = d[M]["excluded"]
    assert ex["row error"] == 1 and ex["no human score"] == 1 and ex["no jev score (not applicable)"] == 1
    assert sum(ex.values()) == 5
    # agreement() uses the same comparable rule, so the KPI denominator matches
    assert summarize(rs, 3)["metrics"][M]["jev_vs_human"]["n"] == 1


def test_no_comparable_and_no_disagreement_cases():
    d = disagreements([row("x", jev=None, human=None)], 3)["jev_vs_llm"]["all"]
    assert d["comparable"] == 0 and d["disagree"] == 0 and d["rows_comparable"] == 0
    d = disagreements([row("y", jev=4, human=5)], 3)["jev_vs_human"]["all"]
    assert d["comparable"] == 1 and d["disagree"] == 0 and d["rows_disagree"] == 0


def test_duplicate_ids_stay_distinct_by_run_position():
    rs = [row("dup", jev=4, human=1), row("dup", jev=4, human=5), row("dup", jev=1, human=5)]
    d = disagreements(rs, 3)["jev_vs_human"][M]
    assert [x["idx"] for x in d["items"]] == [0, 2] and d["rows_disagree"] == 2


def test_foundry_mapping_binds_by_row_index_when_rows_dropped_or_reordered():
    src = [{"id": "dup", f"human_{M}": 1}, {"id": "dup", f"human_{M}": 5}, {"id": "z", f"human_{M}": 2}]
    out = [{"inputs.id": "z", "inputs.row_index": 2, f"outputs.jev.{M}": 2.0, "outputs.jev.jev_properties": {}},
           {"inputs.id": "dup", "inputs.row_index": 1, f"outputs.jev.{M}": 4.0, "outputs.jev.jev_properties": {}}]
    res = to_app_results(out, src, [M])
    assert [r["id"] for r in res] == ["dup", "dup", "z"]
    assert "error" in res[0] and res[1]["human"][M] == 5 and res[1]["jev"][M] == 4.0 and res[2]["jev"][M] == 2.0


def test_foundry_mapping_binds_by_position_not_first_duplicate():
    src = [{"id": "dup", f"human_{M}": 1}, {"id": "dup", f"human_{M}": 5}]
    out = [{"inputs.id": "dup", f"outputs.jev.{M}": 4.0, "outputs.jev.jev_properties": {}},
           {"inputs.id": "dup", f"outputs.jev.{M}": 4.0, "outputs.jev.jev_properties": {}}]
    res = to_app_results(out, src, [M])
    assert [r["human"][M] for r in res] == [1, 5]


def test_stale_run_binding_in_client():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    # the run freezes a snapshot and every request/inspection reads it, not the live dataset
    assert "S.runRows = structuredClone(rr.rows)" in js  # t_7936c995: deep copy of the run_subset projection (default = all rows)
    assert "rows: S.runRows" in js and "S.runRows.slice(" in js
    assert "src = S.runRows[i]" in js and "src.id === x.id" in js
    assert "S.rows[+tr" not in js
    # export stays full-run (not filtered)
    assert "toJSONL(flatResults())" in js and "S.results.map(x =>" in js


def test_independent_recount_real_benchmark():
    R = [json.loads(l) for l in (ROOT / "benchmark/results/results.jsonl").read_text().splitlines() if l.strip()]
    s = summarize(R, 3)
    fin = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    for name, get_b in (("jev_vs_human", lambda r, m: (r.get("human") or {}).get(m)),
                        ("jev_vs_llm", lambda r, m: ((r.get("llm") or {}).get(m) or {}).get("score"))):
        comp = dis = 0; rows = set()
        for i, r in enumerate(R):
            for m in s["metrics"]:
                a, b = (r.get("jev") or {}).get(m), get_b(r, m)
                if fin(a) and fin(b):
                    comp += 1
                    if (a >= 3) != (b >= 3):
                        dis += 1; rows.add(i)
        d = s["disagreements"][name]["all"]
        assert (d["comparable"], d["disagree"], d["rows_disagree"]) == (comp, dis, len(rows))
        assert s["overall"][name]["n"] == comp
        assert round(1 - dis / comp, 3) == s["overall"][name]["pass_fail_agreement"]
    old = json.loads((ROOT / "benchmark/results/summary.json").read_text())
    assert old["overall"] == s["overall"] and old["metrics"] == s["metrics"]


def test_jev_mean_is_order_independent_on_half_tie():
    # 113.12/32 = 3.535 sits on a rounding boundary; the pinned mean must not depend on row order.
    import random
    R = [json.loads(l) for l in (ROOT / "benchmark/results/results.jsonl").read_text().splitlines() if l.strip()]
    rnd = random.Random(7)
    seen = set()
    for _ in range(50):
        rnd.shuffle(R)
        seen.add(summarize(R, 3)["metrics"]["tool_call_accuracy"]["jev_mean"])
    assert seen == {3.54}
