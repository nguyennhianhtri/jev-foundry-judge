"""t_80f908ea: Compare with recorded run (app/static/run_compare.js).
Baseline = a benchmark package opened with the EXISTING openBenchPackage parser; current = a frozen completed run.
Exact typed-id matching unique on both sides, trace same/changed separately, exact signed deltas, missing != 0,
inputs never mutated. Real retained packages (t_e99fa8ea, no key) + focused synthetic edge cases."""
import copy
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
DL = ROOT / "tests" / "fixtures" / "pkg"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")

JS = """const c=require(process.argv[1]),b=require(process.argv[2]),o=require(process.argv[3]),rc=require(process.argv[4]);let d='';
process.stdin.on('data',x=>d+=x).on('end',()=>{const a=JSON.parse(d);let base=a.base;
if(a.pkg){const p=o.openBenchPackage(a.pkg,{...c,...b});const R=p.manifest.run;base={rows:p.rows,results:p.results,version:R.recorded_app_version,at:R.completed_at,scope:R.scope,threshold:R.threshold,llmLabel:R.baseline_label,config:R.recorded_config};}
const before=JSON.stringify([base,a.cur]);const r=rc.buildRunCompare(base,a.cur);
process.stdout.write(JSON.stringify({r,unchanged:before===JSON.stringify([base,a.cur])}))})"""


def run(cur, base=None, pkg=None):
    out = subprocess.run(["node", "-e", JS, str(ST / "bench_compare.js"), str(ST / "bench_brief.js"), str(ST / "bench_package_open.js"), str(ST / "run_compare.js")],
                         input=json.dumps({"cur": cur, "base": base, "pkg": pkg}), capture_output=True, text=True, check=True)
    o = json.loads(out.stdout)
    assert o["unchanged"] is True, "inputs were mutated"
    return o["r"]


def row(i, q="q", **kw):
    return {"id": i, "query": q, "response": "r", **kw}


def res(i, jev=None, llm=None, err=None):
    r = {"id": i, "human": {}, "jev": jev if jev is not None else {}, "jev_detail": {}, "jev_meta": {"model": "jev-1.13.0", "latency_ms": 1, "usd": 1e-5}}
    if llm is not None:
        r["llm"] = llm
    if err:
        r = {"id": i, "error": err}
    return r


def side(rows, results, **kw):
    return {"rows": rows, "results": results, "version": "v1", "at": "2026-09-28T00:00:00Z", "scope": "all", "threshold": 3,
            "llmLabel": None, "config": {"metrics": ["intent_resolution"], "baseline_requested": False, "jev_usd_per_mtok_input": 0.042}, "complete": True, **kw}


def cell(r, id_, judge="jev", metric="intent_resolution"):
    m = next(x for x in r["matched"] if x["id"] == id_ and type(x["id"]) is type(id_))
    return m, next(c for c in m["cells"] if c["judge"] == judge and c["metric"] == metric)


def test_typed_ids_never_cross_match():
    b = side([row(7), row("a")], [res(7, {"intent_resolution": 4.0}), res("a", {"intent_resolution": 3.0})])
    c = side([row("7"), row("a")], [res("7", {"intent_resolution": 5.0}), res("a", {"intent_resolution": 3.5})])
    r = run(c, b)
    assert r["ok"] and [m["id"] for m in r["matched"]] == ["a"]
    assert r["baselineOnly"] == [{"id": 7, "baseline_row": 1}] and r["currentOnly"] == [{"id": "7", "current_row": 1}]
    _, x = cell(r, "a")
    assert x["delta"] == 0.5 and x["baseline"]["v"] == 3.0 and x["current"]["v"] == 3.5


def test_duplicates_on_either_side_are_ambiguous_not_guessed():
    b = side([row("d"), row("d"), row("u"), row("e")], [res("d", {"intent_resolution": 1.0}), res("d", {"intent_resolution": 2.0}), res("u", {"intent_resolution": 2.0}), res("e", {"intent_resolution": 2.0})])
    c = side([row("d"), row("u"), row("e"), row("e"), {"query": "noid"}], [res("d", {"intent_resolution": 5.0}), res("u", {"intent_resolution": 2.0}), res("e", {"intent_resolution": 2.0}), res("e", {"intent_resolution": 2.0}), res(None, {})])
    r = run(c, b)
    assert [m["id"] for m in r["matched"]] == ["u"]
    amb = {a["id"]: a for a in r["ambiguous"]}
    assert amb["d"]["baseline_rows"] == [1, 2] and amb["d"]["current_rows"] == [1]
    assert amb["e"]["current_rows"] == [3, 4]
    assert r["noId"]["current"] == [5]
    _, x = cell(r, "u")
    assert x["delta"] == 0  # a real zero only when both scores exist


def test_missing_metric_is_never_zero_and_no_threshold_switch():
    b = side([row(1), row(2), row(3)], [res(1, {"intent_resolution": 2.99}), res(2, {"intent_resolution": None}), res(3, err="boom")])
    c = side([row(1), row(2), row(3)], [res(1, {"intent_resolution": 3.0}), res(2, {"intent_resolution": 4.0}), res(3, {"intent_resolution": 4.0})])
    r = run(c, b)
    _, x = cell(r, 1)
    assert x["delta"] == 0.01 and "pass" not in json.dumps(x)  # exact, no pass/fail flip reported
    _, y = cell(r, 2)
    assert y["delta"] is None and y["baseline"]["state"] == "no_score"
    _, z = cell(r, 3)
    assert z["delta"] is None and z["baseline"]["state"] == "row_error"
    t = next(t for t in r["tallySame"] if t["judge"] == "jev")
    assert t == {"judge": "jev", "metric": "intent_resolution", "compared": 1, "up": 1, "down": 0, "equal": 0, "missing": 2}


def test_metric_recorded_on_one_side_only_is_not_common():
    b = side([row(1)], [res(1, {"intent_resolution": 4.0, "groundedness": 3.0})])
    c = side([row(1)], [res(1, {"intent_resolution": 4.5}, llm={"intent_resolution": {"score": 4, "result": "pass"}})])
    r = run(c, b)
    assert r["pairs"] == [{"judge": "jev", "metric": "intent_resolution"}]
    assert {"judge": "jev", "metric": "groundedness", "only": "baseline"} in r["notCommon"]
    assert {"judge": "llm", "metric": "intent_resolution", "only": "current"} in r["notCommon"]


def test_trace_changes_split_from_same_input_and_labels_ignored():
    b = side([row(1, human_intent_resolution=5), row(2, q="old")], [res(1, {"intent_resolution": 4.0}), res(2, {"intent_resolution": 4.0})])
    c = side([{"response": "r", "human_intent_resolution": 1, "query": "q", "id": 1}, row(2, q="new")], [res(1, {"intent_resolution": 4.2}), res(2, {"intent_resolution": 2.0})])
    r = run(c, b)
    assert cell(r, 1)[0]["trace"] == "same"      # key order and labels do not count
    assert cell(r, 2)[0]["trace"] == "changed"
    assert r["counts"]["same_trace"] == 1 and r["counts"]["changed_trace"] == 1
    assert next(t for t in r["tallySame"])["up"] == 1 and next(t for t in r["tallyChanged"])["down"] == 1


def test_config_differences_are_stated():
    b = side([row(1)], [res(1, {"intent_resolution": 4.0})], version="v1", config={"metrics": ["intent_resolution"], "jev_usd_per_mtok_input": 0.042})
    c = side([row(1)], [res(1, {"intent_resolution": 4.0})], version="v2", threshold=4, config=None)
    r = run(c, b)
    cfg = {x["key"]: x for x in r["config"]}
    assert not cfg["app_version"]["same"] and not cfg["threshold"]["same"] and cfg["jev_usd_per_mtok_input"]["current"] is None
    assert r["configSame"] is False and r["current"]["config_recorded"] is False


def test_refusals():
    b = side([row(1)], [res(1, {"intent_resolution": 4.0})])
    assert run(side([row(1)], [res(1, {})], complete=False), b) == {"ok": False, "reason": "no_current"}
    assert run(side([row(1)], [res(2, {})]), b)["reason"] == "misaligned"
    assert run(side([row(1)], [res(1, {})]), None)["reason"] == "no_baseline"


def pkg(name):
    p = DL / name
    if not p.exists():
        pytest.skip("retained real packages not present")
    return p.read_text()


def test_real_package_against_itself_is_all_same_zero_delta():
    t = pkg("key-1440-before-package.json")
    p = json.loads(t)
    rows = [json.loads(x) for x in p["files"]["evaluated-dataset.jsonl"].splitlines()]
    flat = [json.loads(x) for x in p["files"]["results.jsonl"].splitlines()]
    # current side from the same real recorded rows (independent reconstruction of the raw shape)
    cur_res = []
    for f in flat:
        r = {"id": f["id"], "jev": {}, "jev_detail": {}, "jev_meta": {"model": f.get("jev_model")}, "llm": {}}
        for m in ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]:
            if f"jev_{m}" in f:
                r["jev"][m] = f[f"jev_{m}"]
            if f"llm_{m}" in f:
                r["llm"][m] = {"score": f[f"llm_{m}"]}
        cur_res.append(r)
    cur = side(rows, cur_res, config=p["manifest"]["run"]["recorded_config"], version=p["manifest"]["run"]["recorded_app_version"])
    r = run(cur, pkg=t)
    assert r["ok"] and r["counts"]["matched"] == len(rows) == 7 and r["counts"]["same_trace"] == 7
    for m in r["matched"]:
        for c in m["cells"]:
            assert c["delta"] in (0, None)
            if c["delta"] is None:
                assert c["baseline"]["state"] != "score" or c["current"]["state"] != "score"


def test_real_two_packages_exact_deltas_recomputed():
    a, b = pkg("key-1440-before-package.json"), pkg("replay-1440-before-package.json")
    pa, pb = json.loads(a), json.loads(b)
    ra = [json.loads(x) for x in pa["files"]["results.jsonl"].splitlines()]
    rows = [json.loads(x) for x in pb["files"]["evaluated-dataset.jsonl"].splitlines()]
    fb = [json.loads(x) for x in pb["files"]["results.jsonl"].splitlines()]
    cur_res = [{"id": f["id"], "jev": {m[4:]: f[m] for m in f if m.startswith("jev_") and m[4:] in ("intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness")}, "jev_detail": {}, "jev_meta": {}} for f in fb]
    r = run(side(rows, cur_res, config=None), pkg=a)
    ida = {x["id"]: x for x in ra}
    for m in r["matched"]:
        for c in m["cells"]:
            if c["judge"] != "jev":
                continue
            bv, cv = ida[m["id"]].get("jev_" + c["metric"]), next(f for f in fb if f["id"] == m["id"]).get("jev_" + c["metric"])
            if isinstance(bv, (int, float)) and isinstance(cv, (int, float)):
                assert c["delta"] == pytest.approx(cv - bv, abs=1e-12)
            else:
                assert c["delta"] is None


# ---- t_444de45e: recorded score decreases focus -------------------------------------------------------------
JS_DEC = """const rc=require(process.argv[1]);let d='';process.stdin.on('data',x=>d+=x).on('end',()=>{const a=JSON.parse(d);
const r=rc.buildRunCompare(a.base,a.cur);const before=JSON.stringify(r);const o=rc.runCompareDecreases(r,a.j,a.m);
process.stdout.write(JSON.stringify({o,unchanged:before===JSON.stringify(r)}))})"""


def dec(cur, base, j="jev", m="intent_resolution"):
    out = subprocess.run(["node", "-e", JS_DEC, str(ST / "run_compare.js")], input=json.dumps({"cur": cur, "base": base, "j": j, "m": m}),
                         capture_output=True, text=True, check=True)
    o = json.loads(out.stdout)
    assert o["unchanged"] is True
    return o["o"]


def ir(v):
    return {"intent_resolution": v}


def test_decreases_order_ties_exact_and_exclusions():
    ids = ["a", 7, "7", "t1", "t2", "chg", "miss", "up", "eq", "dup", "dup", "bo"]
    bv = [4.0, 3.0, 5.0, 4.5, 4.5, 5.0, 4.0, 2.0, 3.0, 5.0, 5.0, 5.0]
    brows = [row(i, q="changed-before" if i == "chg" else "q") for i in ids]
    b = side(brows, [res(i, ir(v)) for i, v in zip(ids, bv)])
    cids = ["t2", "a", 7, "7", "t1", "chg", "miss", "up", "eq", "dup", "dup", "co"]
    cv = {"t2": 4.0, "a": 2.99, 7: 2.0, "7": 5.0, "t1": 4.0, "chg": 1.0, "miss": None, "up": 3.0, "eq": 3.0, "dup": 1.0, "co": 1.0}
    c = side([row(i) for i in cids], [res(i, ir(cv[i])) for i in cids])
    o = dec(c, b)
    assert o["ok"]
    got = [(x["id"], x["baseline"], x["current"], x["delta"]) for x in o["shown"]]
    # a -1.01 exact; 7 (number) -1; ties t2/t1 -0.5 by current row (t2 row1, t1 row5); "7" text equal, not shown
    assert got == [("a", 4.0, 2.99, -1.01), (7, 3.0, 2.0, -1.0), ("t2", 4.5, 4.0, -0.5), ("t1", 4.5, 4.0, -0.5)]
    assert type(o["shown"][1]["id"]) is int
    assert o["eligible"] == 7 and o["not_lower"] == 3  # "7", up, eq
    assert o["excluded"] == {"changed": 1, "cannot_compare": 0, "missing": 1}
    assert o["not_matched"] == 3  # dup ambiguous, bo, co
    assert all(x["id"] not in ("chg", "miss", "dup", "bo", "co") for x in o["shown"])


def test_decreases_selected_pair_and_empty_states():
    b = side([row(1), row(2)], [res(1, {"intent_resolution": 4.0, "groundedness": 3.0}), res(2, {"intent_resolution": 4.0, "groundedness": 3.0})])
    c = side([row(1), row(2)], [res(1, {"intent_resolution": 5.0, "groundedness": 2.0}), res(2, {"intent_resolution": 4.0, "groundedness": None})])
    g = dec(c, b, m="groundedness")
    assert [(x["id"], x["delta"]) for x in g["shown"]] == [(1, -1.0)] and g["eligible"] == 1 and g["excluded"]["missing"] == 1
    i = dec(c, b)
    assert i["shown"] == [] and i["eligible"] == 2 and i["not_lower"] == 2
    assert dec(c, b, j="llm")["reason"] == "not_common"
    assert dec(c, b, m="task_adherence") == {"ok": False, "reason": "not_common"}
    b2 = side([row(1)], [res(1, {"groundedness": 3.0})])
    c2 = side([row(1)], [res(1, {"intent_resolution": 3.0})])
    assert dec(c2, b2)["reason"] == "no_pairs"
    assert dec({"rows": []}, b)["reason"] == "no_compare"


def test_decreases_all_changed_inputs_yield_zero_eligible():
    b = side([row(1, q="x")], [res(1, ir(5.0))])
    c = side([row(1, q="y")], [res(1, ir(1.0))])
    o = dec(c, b)
    assert o["eligible"] == 0 and o["shown"] == [] and o["excluded"]["changed"] == 1
