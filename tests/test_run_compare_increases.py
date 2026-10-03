"""t_5c9dac5a: "Recorded score increases" = the SAME sign-aware runCompareChanges projection as decreases (run_compare.js).
SYNTHETIC fixtures (honestly labelled): positive/negative/zero deltas, numeric 7 vs text "7", changed input, missing score,
ambiguous/one-sided ids. Zero is unchanged (never a gain); largest increase first; ties by current row order."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
IR = "intent_resolution"

JS = """const rc=require(process.argv[1]),bb=require(process.argv[2]),b=require(process.argv[3]);let d='';
process.stdin.on('data',x=>d+=x).on('end',()=>{const a=JSON.parse(d);const r=rc.buildRunCompare(a.base,a.cur);const before=JSON.stringify(r);
const inc=rc.runCompareIncreases(r,'jev',a.m),dec=rc.runCompareDecreases(r,'jev',a.m),gen=rc.runCompareChanges(r,'jev',a.m,'inc'),bad=rc.runCompareChanges(r,'jev',a.m,'up');
const brief=o=>b.buildRunCompareBrief({compare:r,view:{order:o},meta:{app_version:'vX',generated_at:'T',file_name:'pkg.json'}},{mdCell:bb.mdCell,runCompareDecreases:rc.runCompareDecreases,runCompareChanges:rc.runCompareChanges});
const mis=b.buildRunCompareBrief({compare:r,view:{order:'inc'},decreases:dec,meta:{}},{mdCell:bb.mdCell,runCompareChanges:rc.runCompareChanges});
const noChg=b.buildRunCompareBrief({compare:r,view:{order:'inc'},meta:{}},{mdCell:bb.mdCell,runCompareDecreases:rc.runCompareDecreases,runCompareChanges:null});
process.stdout.write(JSON.stringify({inc,dec,gen,bad,mis,noChg,bi:brief('inc'),bd:brief('dec'),unchanged:before===JSON.stringify(r)}))})"""


def row(i, q="q"):
    return {"id": i, "query": q, "response": "SECRET-" + str(i)}


def side(rows, results):
    return {"rows": rows, "results": results, "version": "v1", "at": "t", "scope": "all", "threshold": 3, "llmLabel": None,
            "config": {"metrics": [IR]}, "complete": True}


def res(i, v):
    return {"id": i, "jev": {IR: v}, "jev_detail": {}, "jev_meta": {"model": "jev"}}


def run():
    ids = ["a", 7, "7", "t1", "t2", "chg", "miss", "down", "eq", "dup", "dup", "bo"]
    bv = [2.0, 3.0, 3.0, 3.5, 3.5, 1.0, 2.0, 5.0, 3.0, 1.0, 1.0, 1.0]
    b = side([row(i, q="old" if i == "chg" else "q") for i in ids], [res(i, v) for i, v in zip(ids, bv)])
    cids = ["t2", "a", 7, "7", "t1", "chg", "miss", "down", "eq", "dup", "dup", "co"]
    cv = {"t2": 4.0, "a": 3.01, 7: 3.0, "7": 5.0, "t1": 4.0, "chg": 5.0, "miss": None, "down": 1.0, "eq": 3.0, "dup": 5.0, "co": 5.0}
    c = side([row(i) for i in cids], [res(i, cv[i]) for i in cids])
    o = json.loads(subprocess.run(["node", "-e", JS, str(ST / "run_compare.js"), str(ST / "bench_brief.js"), str(ST / "run_compare_brief.js")],
                                  input=json.dumps({"base": b, "cur": c, "m": IR}), capture_output=True, text=True, check=True).stdout)
    assert o["unchanged"]
    return o


def test_increases_order_ties_zero_and_typed_ids():
    o = run(); i = o["inc"]
    got = [(x["id"], x["baseline"], x["current"], x["delta"]) for x in i["shown"]]
    # "7" text +2 first; a +1.01 exact; ties t2/t1 +0.5 by current row (t2 row1 before t1 row5); number 7 is 0 = unchanged
    assert got == [("7", 3.0, 5.0, 2.0), ("a", 2.0, 3.01, 1.01), ("t2", 3.5, 4.0, 0.5), ("t1", 3.5, 4.0, 0.5)]
    assert type(i["shown"][0]["id"]) is str and all(x["id"] != 7 for x in i["shown"])
    assert i["direction"] == "inc" and i["eligible"] == 7 and i["not_higher"] == 3
    assert i["unchanged"] == 2 and i["opposite"] == 1  # 7 and eq unchanged; down lower
    assert i["excluded"] == {"changed": 1, "cannot_compare": 0, "missing": 1} and i["not_matched"] == 3
    assert all(x["id"] not in ("chg", "miss", "dup", "bo", "co", "eq", "down") for x in i["shown"])
    assert o["gen"] == i and o["bad"] == {"ok": False, "reason": "bad_direction"}


def test_decreases_unchanged_by_shared_projection():
    d = run()["dec"]
    assert [(x["id"], x["delta"]) for x in d["shown"]] == [("down", -4.0)]
    assert d["not_lower"] == 6 and d["unchanged"] == 2 and d["opposite"] == 4 and d["eligible"] == 7
    assert "not_higher" not in d and d["direction"] == "dec"


def test_brief_describes_the_selected_direction():
    o = run(); bi, bd = o["bi"], o["bd"]
    assert "Order: Recorded score increases, largest increase first" in bi and "decreases, largest" not in bi
    assert "Shown: 4 of 7 eligible cases have a higher recorded score" in bi
    assert "Not higher: 3 (unchanged 2 · lower 1)" in bi and "input changed 1" in bi and "a score missing 1" in bi
    sec = bi.split("## Cases shown (4)", 1)[1].split("## Method note")[0]
    assert '| 1 | "7" (text) |' in sec and "| +2 |" in sec and "| 4 | \"t1\" (text) |" in sec
    assert "not a verified improvement" in bi and "SECRET-" not in bi
    assert "Order: Recorded score decreases, largest decrease first" in bd and "Shown: 1 of 7 eligible cases have a lower" in bd


def test_brief_never_uses_a_decreases_projection_for_an_increases_view():
    o = run()
    assert "Order: Recorded score increases" in o["mis"] and "Shown: 4 of 7" in o["mis"]
    # without the sign-aware projection the increases brief is withheld, never silently a decreases brief
    assert o["noChg"] is None or "Recorded score decreases" not in o["noChg"]
