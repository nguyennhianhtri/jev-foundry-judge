"""t_3d9f9b07: comparison brief (.md) of the Compare-with-recorded-run view (app/static/run_compare_brief.js).
Formats the SAME buildRunCompare result and runCompareDecreases projection; the file is parsed independently here and
reconciled against raw rows/results (membership, order, typed IDs, deltas, denominators). Missing != 0, no trace text."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")

JS = """const rc=require(process.argv[1]),bb=require(process.argv[2]),b=require(process.argv[3]);let d='';
process.stdin.on('data',x=>d+=x).on('end',()=>{const a=JSON.parse(d);const r=rc.buildRunCompare(a.base,a.cur);const before=JSON.stringify(r);
const D=a.view.order==='dec'&&r.ok&&r.pairs.length?rc.runCompareDecreases(r,...(a.view.dec||`${r.pairs[0].judge}:${r.pairs[0].metric}`).split(':')):null;
const t=b.buildRunCompareBrief({compare:r,view:a.view,decreases:D,meta:{app_version:'vX',generated_at:'2026-09-28T00:00:00Z',file_name:'pkg.json'}},{mdCell:bb.mdCell,runCompareDecreases:rc.runCompareDecreases});
const t2=b.buildRunCompareBrief({compare:r,view:a.view,meta:{app_version:'vX',generated_at:'2026-09-28T00:00:00Z',file_name:'pkg.json'}},{mdCell:bb.mdCell,runCompareDecreases:rc.runCompareDecreases});
process.stdout.write(JSON.stringify({t,t2,unchanged:before===JSON.stringify(r)}))})"""


def brief(cur, base, **view):
    out = subprocess.run(["node", "-e", JS, str(ST / "run_compare.js"), str(ST / "bench_brief.js"), str(ST / "run_compare_brief.js")],
                         input=json.dumps({"cur": cur, "base": base, "view": view}), capture_output=True, text=True, check=True)
    o = json.loads(out.stdout)
    assert o["unchanged"] is True
    assert o["t"] == o["t2"]  # passing the rendered projection or recomputing it yields identical bytes
    return o["t"]


def side(rows, results, version="v1", at="2026-09-28T00:00:00Z", **kw):
    return {"rows": rows, "results": results, "version": version, "at": at, "scope": "all", "threshold": 3, "llmLabel": None,
            "config": {"metrics": ["intent_resolution", "groundedness"], "baseline_requested": False, "jev_usd_per_mtok_input": 0.042}, "complete": True, **kw}


def row(i, q="q", **kw):
    return {"id": i, "query": q, "response": "SECRET-TRACE-" + str(i), **kw}


def res(i, jev):
    return {"id": i, "human": {}, "jev": jev, "jev_detail": {}, "jev_meta": {"model": "jev-1.13.0"}}


def table(md):
    """independent parser: the rows of the '## Cases shown' table"""
    sec = md.split("## Cases shown", 1)[1].split("## Method note", 1)[0]
    lines = [l for l in sec.splitlines() if l.startswith("|")]
    return [[c.strip() for c in l.strip("|").split(" | ")] for l in lines[2:]]


IDS = ["a", 7, "7", "t1", "t2", "chg", "miss", "up", "dup", "dup", "bo"]
BV = [4.0, 3.0, 5.0, 4.5, 4.5, 5.0, 4.0, 2.0, 5.0, 5.0, 5.0]
CIDS = ["t2", "a", 7, "7", "t1", "chg", "miss", "up", "dup", "dup", "co"]
CV = {"t2": 4.0, "a": 2.99, 7: 2.0, "7": 5.0, "t1": 4.0, "chg": 1.0, "miss": None, "up": 3.0, "dup": 1.0, "co": 1.0}


def fixture():
    b = side([row(i, q="old" if i == "chg" else "q", human_intent_resolution=5, note="PRIVATE-NOTE") for i in IDS],
             [res(i, {"intent_resolution": v, "groundedness": 3.0}) for i, v in zip(IDS, BV)], version="v1.48.0")
    c = side([row(i, note="PRIVATE-NOTE") for i in CIDS], [res(i, {"intent_resolution": CV[i], "groundedness": 3.0}) for i in CIDS], version="v1.49.0",
             at="2026-09-28T01:00:00Z")
    return b, c


def test_decreases_brief_reconciles_with_raw():
    b, c = fixture()
    md = brief(c, b, order="dec", dec="jev:intent_resolution")
    # independent recompute from raw: unique typed ids, same input, both finite, delta<0, asc, tie by current row
    key = lambda v: (type(v).__name__, v)
    bk = {}
    for i, r in enumerate(b["rows"]):
        bk.setdefault(key(r["id"]), []).append(i)
    exp = []
    for ci, r in enumerate(c["rows"]):
        k = key(r["id"])
        if len(bk.get(k, [])) != 1 or sum(key(x["id"]) == k for x in c["rows"]) != 1:
            continue
        bi = bk[k][0]
        if b["rows"][bi]["query"] != r["query"]:
            continue
        bs, cs = b["results"][bi]["jev"]["intent_resolution"], c["results"][ci]["jev"]["intent_resolution"]
        if not isinstance(bs, float) or not isinstance(cs, float):
            continue
        d = round(cs - bs, 12)
        if d < 0:
            exp.append((d, ci, r["id"], bi, bs, cs))
    exp.sort(key=lambda x: (x[0], x[1]))
    got = table(md)
    assert [g[1] for g in got] == [f'"{x[2]}" (text)' if isinstance(x[2], str) else f"{x[2]} (number)" for x in exp]
    for g, x in zip(got, exp):
        assert g[2] == f"{x[3] + 1} → {x[1] + 1}"
        assert float(g[3]) == x[4] and float(g[4]) == x[5] and float(g[5]) == x[0]
    assert got[0][5] == "-1.01" and got[1][1] == "7 (number)"
    assert "- Shown: 4 of 6 eligible cases" in md
    assert "- Not lower: 2 (unchanged 1 · higher 1) · left out: input changed 1 · input not comparable 0 · a score missing 1 · not matched by ID 3" in md
    assert "app v1.48.0, completed 2026-09-28T00:00:00Z, 11 rows" in md and "app v1.49.0, completed 2026-09-28T01:00:00Z" in md
    assert "Jev: Intent resolution" in md and "recorded score decreases, not verified regressions" in md
    for bad in ("SECRET-TRACE", "PRIVATE-NOTE", "human_", "regression.", "significan" + "t ", "winner is"):
        assert bad not in md
    assert '"chg"' not in md.split("## Cases shown")[1]


def test_dataset_order_brief_filters_and_missing_never_zero():
    b, c = fixture()
    md = brief(c, b, order="dataset", trace="all")
    got = table(md)
    # matched in current row order: t2 a 7 "7" t1 chg miss up (dup ambiguous, bo/co one side)
    assert [g[1] for g in got] == ['"t2" (text)', '"a" (text)', "7 (number)", '"7" (text)', '"t1" (text)', '"chg" (text)', '"miss" (text)', '"up" (text)']
    miss = next(g for g in got if g[1] == '"miss" (text)')
    assert miss[4] == "4 → unavailable (no score) (not compared)"
    assert next(g for g in got if g[1] == '"chg" (text)')[3] == "input changed"
    assert "- Shown: 8 of 8 matched cases" in md
    same = table(brief(c, b, order="dataset", trace="changed"))
    assert [g[1] for g in same] == ['"chg" (text)']


def test_differing_settings_and_no_pairs_and_escaping():
    b, c = fixture()
    c["config"] = {**c["config"], "jev_usd_per_mtok_input": 0.05}
    md = brief(c, b, order="dataset")
    assert "- App version: recorded v1.48.0 · current v1.49.0" in md
    assert "- Jev price per 1M input tokens: recorded 0.042 · current 0.05" in md
    c["config"] = {**c["config"], "metrics": ["intent_resolution"]}
    assert "- Metrics requested: recorded Intent resolution, Groundedness · current Intent resolution" in brief(c, b, order="dataset")
    q = brief(side([row('a"b')], [res('a"b', {"intent_resolution": 2.0})]), side([row('a"b')], [res('a"b', {"intent_resolution": 3.0})]), order="dec")
    assert table(q)[0][1] == '"a\\\\"b" (text)'
    b2 = side([row("x|*y")], [res("x|*y", {"groundedness": 3.0})])
    c2 = side([row("x|*y")], [res("x|*y", {"intent_resolution": 3.0})])
    md2 = brief(c2, b2, order="dec")
    assert "no scores are compared and no cases are listed" in md2 and "## Cases shown" not in md2
    md3 = brief(side([row("x|*y")], [res("x|*y", {"intent_resolution": 2.0})]), side([row("x|*y")], [res("x|*y", {"intent_resolution": 3.0})]), order="dec")
    assert '"x\\|\\*y" (text)' in md3 and table(md3)[0][5] == "-1"


def test_refuses_without_completed_compare():
    b, _ = fixture()
    md = brief({"rows": [], "results": [], "complete": False}, b, order="dataset")
    assert md is None
