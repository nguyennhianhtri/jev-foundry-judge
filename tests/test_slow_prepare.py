"""t_7d8754cd: prepare the slow cases for another run in place (Dataset selection + Selected-cases Run scope).
Retained REAL run for the main case; labelled synthetic fixtures for typed ids / duplicates / stale / removed."""
import json, shutil, subprocess
from pathlib import Path
import pytest

R = Path(__file__).resolve().parents[1]
SC = R / "app" / "static" / "slow_cases.js"
SP = R / "app" / "static" / "slow_prepare.js"
REAL = R / "tests" / "fixtures" / "real-run-t389-key1440-frozen-state.json"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def node(body, **kw):
    code = ("const L=require(process.argv[1]);const P=require(process.argv[2]);const A=JSON.parse(process.argv[3]);"
            "process.stdout.write(JSON.stringify((()=>{" + body + "})()))")
    return json.loads(subprocess.run(["node", "-e", code, str(SC), str(SP), json.dumps(kw)], capture_output=True, text=True, check=True).stdout)


PREP = ("const sc=L.slowCases({results:A.r,summary:A.s});const s0=JSON.stringify([A.rr,A.rows,A.sel]);"
        "const o=P.prepareSlowRerun({sc,runRows:A.rr,runPos:A.rp,rows:A.rows,selected:new Set(A.sel)});"
        "o._same=JSON.stringify([A.rr,A.rows,A.sel])===s0;o._members=(sc.members||[]).map(e=>e.pos);return o")


def test_real_run_maps_members_to_unchanged_dataset_rows():
    st = json.loads(REAL.read_text()); res, rr, s = st["results"], st["runRows"], st["summary"]
    extra = {"id": "extra", "query": "not in run"}
    rows = [extra] + rr                                   # dataset shifted by one; no runPos (retained run predates it)
    o = node(PREP, r=res, s=s, rr=rr, rp=None, rows=rows, sel=[0])
    assert o["ok"] and o["_same"]
    want = sorted(p + 1 for p in o["_members"])
    assert o["after"]["positions"] == want and o["before"]["positions"] == [0]
    assert o["removed"] == 1 and o["added"] == len(want) and o["total"] == len(rows)
    assert all(m["via"] == "unique identical row" for m in o["mapped"])


def fx():
    rr = [{"id": 7, "q": "a"}, {"id": "7", "q": "b"}, {"id": "dup", "q": "c"}, {"id": "dup", "q": "d"}]
    r = [{"id": x["id"], "jev_meta": {"latency_ms": ms}} for x, ms in zip(rr, [900, 100, 950, 50])]
    return rr, r, {"jev": {"p95_ms": 900}}


def test_typed_ids_and_duplicates_via_run_position():
    rr, r, s = fx()   # members: pos 2 ("dup" c), pos 0 (7)
    rows = json.loads(json.dumps(rr)) + [{"id": 7, "q": "a"}]   # an identical copy of 7 appended
    o = node(PREP, r=r, s=s, rr=rr, rp=[0, 1, 2, 3], rows=rows, sel=[1])
    assert o["ok"] and o["after"]["positions"] == [0, 2] and o["after"]["ids"] == [7, "dup"]
    # same dataset, no run positions: identical copy of 7 -> ambiguous, whole prep refused, selection untouched
    o = node(PREP, r=r, s=s, rr=rr, rp=None, rows=rows, sel=[1])
    assert not o["ok"] and o["reason"] == "unmappable" and "ambiguous" in o["problems"][0]["why"] and o["_same"]
    # "7" string row must never satisfy member id 7 (number)
    rows2 = [{"id": "7", "q": "a"}, rr[1], rr[2], rr[3]]
    o = node(PREP, r=r, s=s, rr=rr, rp=[0, 1, 2, 3], rows=rows2, sel=[])
    assert not o["ok"] and o["problems"][0]["id"] == 7 and "no longer in the dataset" in o["problems"][0]["why"]


def test_stale_label_edit_removed_and_no_dataset_refuse():
    rr, r, s = fx()
    edited = json.loads(json.dumps(rr)); edited[0]["human"] = {"intent_resolution": 5}
    o = node(PREP, r=r, s=s, rr=rr, rp=[0, 1, 2, 3], rows=edited, sel=[3])
    assert not o["ok"] and "changed since the run" in o["problems"][0]["why"] and o["before"]["positions"] == [3]
    o = node(PREP, r=r, s=s, rr=rr, rp=[0, 1, 2, 3], rows=[], sel=[])
    assert o["reason"] == "no_dataset"
    o = node(PREP, r=r, s={"jev": {"p95_ms": None}}, rr=rr, rp=[0, 1, 2, 3], rows=rr, sel=[])
    assert o["reason"] == "empty"
    o = node(PREP, r=r, s=s, rr=rr, rp=[0, 1, 2, 3], rows=rr, sel=[0, 2])
    assert o["ok"] and o["same"] and o["added"] == 0 and o["removed"] == 0


def test_app_wiring_explicit_no_run():
    a = (R / "app/static/app.js").read_text(); h = (R / "app/static/index.html").read_text()
    assert h.index("slow_cases.js") < h.index("slow_prepare.js") < h.index("/static/app.js")
    for k in ("Prepare these cases for another run", "S.runPos = rr.positions.slice()", "Cancel", "nothing was changed",
              "not a speed or accuracy gain", "Nothing runs and nothing is spent until you press Run"):
        assert k in a, k
    blk = a[a.index('if (e.target.closest("#slowPrepBtn"))'):a.index('if (e.target.closest("#slowClear"))')]
    assert "api(" not in blk and "fetch(" not in blk and "runBtn" not in blk and "S.results =" not in blk and "S.rows =" not in blk


def test_key_order_is_not_an_edit_but_type_is():
    rr, r, s = fx()
    reordered = [{"q": x["q"], "id": x["id"]} for x in rr]            # same content, keys in another order
    o = node(PREP, r=r, s=s, rr=rr, rp=[0, 1, 2, 3], rows=reordered, sel=[])
    assert o["ok"] and o["after"]["positions"] == [0, 2]
    typed = json.loads(json.dumps(rr)); typed[2]["q"] = ["c"]            # value type changed -> refused
    o = node(PREP, r=r, s=s, rr=rr, rp=[0, 1, 2, 3], rows=typed, sel=[])
    assert not o["ok"]


def test_prepared_notice_and_stale_preview_wiring():
    a = (R / "app/static/app.js").read_text()
    assert "S.prepNotice" in a and 'id="prepNotice"' in a and "the preview below is updated" in a
    assert "S.runPos = null; S.slowPrep = null; S.disPrep = null; S.failPrep = null; S.prepNotice = null;" in a
