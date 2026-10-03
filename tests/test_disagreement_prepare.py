"""t_0e0d57f4: prepare the shown disagreement cases for another run (same prepareRerun binding as slow cases).
Retained REAL run for membership; labelled synthetic fixtures for typed ids / duplicates / stale / mismatched id."""
import json, shutil, subprocess
from pathlib import Path
import pytest
from jev_foundry_judge.stats import disagreements

R = Path(__file__).resolve().parents[1]
SP = R / "app" / "static" / "slow_prepare.js"
REAL = R / "tests" / "fixtures" / "real-run-t389-key1440-frozen-state.json"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def prep(**kw):
    code = ("const P=require(process.argv[1]);const A=JSON.parse(process.argv[2]);const s0=JSON.stringify(A);"
            "const o=P.prepareRerun({members:A.m,runRows:A.rr,runPos:A.rp,rows:A.rows,selected:new Set(A.sel)});"
            "o._same=JSON.stringify(A)===s0;process.stdout.write(JSON.stringify(o))")
    return json.loads(subprocess.run(["node", "-e", code, str(SP), json.dumps(kw)], capture_output=True, text=True, check=True).stdout)


def members(d, view, metric):
    return [{"pos": p, "id": i} for p, i in sorted({(x["idx"], json.dumps(x["id"])) for x in d[view][metric]["items"]})]


def test_real_run_disagreement_members_map_exactly():
    st = json.loads(REAL.read_text()); res, rr = st["results"], st["runRows"]
    d = disagreements(res, st["summary"]["threshold"])
    for view in ("jev_vs_human", "jev_vs_llm"):
        m = [{"pos": e["pos"], "id": json.loads(e["id"])} for e in members(d, view, "all")]
        if not m: continue
        rows = [{"id": "extra", "q": "x"}] + rr
        o = prep(m=m, rr=rr, rp=[i + 1 for i in range(len(rr))], rows=rows, sel=[0])
        assert o["ok"] and o["_same"]
        assert o["after"]["positions"] == [e["pos"] + 1 for e in m]
        assert o["after"]["ids"] == [e["id"] for e in m] and o["removed"] == 1
        assert all(x["via"] == "run position" for x in o["mapped"])
        return
    pytest.skip("retained run has no disagreements")


def test_typed_id_mismatch_and_duplicates_and_stale():
    rr = [{"id": 7, "q": "a"}, {"id": "7", "q": "b"}, {"id": "d", "q": "c"}, {"id": "d", "q": "c"}]
    # shown id "7" at pos 0 (frozen id 7) must refuse, never rebind to the "7" row
    o = prep(m=[{"pos": 0, "id": "7"}], rr=rr, rp=[0, 1, 2, 3], rows=rr, sel=[1])
    assert not o["ok"] and "no longer matches" in o["problems"][0]["why"] and o["before"]["positions"] == [1]
    # identical duplicates bind via run positions only
    o = prep(m=[{"pos": 3, "id": "d"}], rr=rr, rp=[0, 1, 2, 3], rows=rr, sel=[])
    assert o["ok"] and o["after"]["positions"] == [3]
    o = prep(m=[{"pos": 3, "id": "d"}], rr=rr, rp=None, rows=rr, sel=[])
    assert not o["ok"] and "ambiguous" in o["problems"][0]["why"]
    # relabelled row refuses whole prep
    ed = json.loads(json.dumps(rr)); ed[0]["human"] = {"groundedness": 1}
    o = prep(m=[{"pos": 0, "id": 7}, {"pos": 1, "id": "7"}], rr=rr, rp=[0, 1, 2, 3], rows=ed, sel=[])
    assert not o["ok"] and len(o["problems"]) == 1 and o["mapped_n"] == 1
    assert prep(m=[], rr=rr, rp=None, rows=rr, sel=[])["reason"] == "empty"
    assert prep(m=[{"pos": 0, "id": 7}], rr=rr, rp=None, rows=[], sel=[])["reason"] == "no_dataset"


def test_wiring_one_action_no_run_invalidates():
    a = (R / "app/static/app.js").read_text(); h = (R / "app/static/index.html").read_text()
    assert 'id="disBar"' in h and h.index("slow_prepare.js") < h.index("/static/app.js")
    blk = a[a.index('$("#disBar")?.addEventListener'):a.index("// ---------- slow cases behind the p95 headline")]
    assert "api(" not in blk and "fetch(" not in blk and "runBtn" not in blk and "S.results =" not in blk and "S.rows =" not in blk
    for k in ("prepareRerun({ members: disMembers()", "not an accuracy gain", "different measurements",
              "Nothing runs and nothing is spent until you press Run", "P.key !== disKey()", "so nothing was changed"):
        assert k in a, k


def test_row_without_id_null_vs_absent_binds_but_typed_id_does_not():
    rr = [{"q": "no id"}, {"id": 0, "q": "zero"}]
    o = prep(m=[{"pos": 0, "id": None}], rr=rr, rp=[0, 1], rows=rr, sel=[])   # results id null, frozen row has no id
    assert o["ok"] and o["after"]["positions"] == [0]
    o = prep(m=[{"pos": 1, "id": None}], rr=rr, rp=[0, 1], rows=rr, sel=[])   # null must not match typed 0
    assert not o["ok"]
