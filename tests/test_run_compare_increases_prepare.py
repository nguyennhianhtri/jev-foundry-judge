"""t_3e9f0c98: prepare the Recorded score INCREASES for an explicit repeat run through the SAME composition as decreases:
runCompareChanges(..., "inc").shown -> {pos: current_pos, id} -> prepareRerun. SYNTHETIC fixtures (stored fixture scores,
not live judge output) + static wiring checks on app.js (direction-bound validity, no network/run, labels)."""
import json, re, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const RC=require(process.argv[1]),P=require(process.argv[2]);let d='';"
        "process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const b0=JSON.stringify(a);"
        "const r=RC.buildRunCompare(a.base,a.cur);const D=RC.runCompareChanges(r,a.j,a.m,a.dir);"
        "const L=D.ok?D.shown.map(x=>({pos:x.current_pos,id:x.id})):[];"
        "const o=P.prepareRerun({members:L,runRows:a.cur.rows,runPos:a.rp,rows:a.rows,selected:new Set(a.sel)});"
        "o.D=D;o.unchanged=JSON.stringify(a)===b0;process.stdout.write(JSON.stringify(o))})")
IR = "intent_resolution"


def run(**a):
    out = subprocess.run(["node", "-e", CODE, str(ST / "run_compare.js"), str(ST / "slow_prepare.js")],
                         input=json.dumps(a), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


BROWS = [{"id": 7, "query": "q"}, {"id": "7", "query": "q2"}, {"id": "ctx", "query": "old"}, {"id": "dn", "query": "d"},
         {"id": "eq", "query": "e"}, {"id": "miss", "query": "m"}]
BRES = [{"id": 7, "jev": {IR: 2}}, {"id": "7", "jev": {IR: 1}}, {"id": "ctx", "jev": {IR: 1}}, {"id": "dn", "jev": {IR: 5}},
        {"id": "eq", "jev": {IR: 3}}, {"id": "miss", "jev": {IR: 1}}]
CROWS = [{"id": "dn", "query": "d"}, {"id": 7, "query": "q"}, {"id": "ctx", "query": "new"}, {"id": "7", "query": "q2", "human_intent_resolution": 4},
         {"id": "eq", "query": "e"}, {"id": "miss", "query": "m"}]
CRES = [{"id": "dn", "jev": {IR: 1}}, {"id": 7, "jev": {IR: 3}}, {"id": "ctx", "jev": {IR: 5}}, {"id": "7", "jev": {IR: 5}},
        {"id": "eq", "jev": {IR: 3}}, {"id": "miss", "jev": {}}]
B = {"rows": BROWS, "results": BRES, "version": "vB"}
C = {"rows": CROWS, "results": CRES, "version": "vC", "complete": True}
cp = lambda x: json.loads(json.dumps(x))


def test_increases_prepare_exact_shown_current_rows_typed_ids():
    extra = {"id": "extra", "query": "not in run"}
    rows = [extra] + cp(CROWS)                                        # current dataset shifted by one
    o = run(base=B, cur=C, j="jev", m=IR, dir="inc", rp=[i + 1 for i in range(6)], rows=rows, sel=[0, 1])
    assert o["unchanged"] and o["ok"]
    assert [x["id"] for x in o["D"]["shown"]] == ["7", 7]             # "7" +4 before 7 +1; ctx/eq/dn/miss never
    assert o["after"]["positions"] == [2, 4] and o["after"]["ids"] == [7, "7"]   # dataset order, typed
    assert o["before"]["positions"] == [0, 1] and o["added"] == 2 and o["removed"] == 2
    assert all(m["via"] == "run position" for m in o["mapped"])
    dec = run(base=B, cur=C, j="jev", m=IR, dir="dec", rp=None, rows=cp(CROWS), sel=[])
    assert [x["id"] for x in dec["D"]["shown"]] == ["dn"] and dec["after"]["ids"] == ["dn"]   # disjoint, unchanged


def test_increases_prepare_refusals_never_substitute_or_select_all():
    # text "7" standing where number 7 was -> refuse, never substituted
    r = run(base=B, cur=C, j="jev", m=IR, dir="inc", rp=None, rows=[CROWS[0], {"id": "7", "query": "q"}] + cp(CROWS[2:]), sel=[5])
    assert not r["ok"] and any(p["id"] == 7 for p in r["problems"]) and r["before"]["positions"] == [5]
    # ambiguous identical copy without run positions
    r = run(base=B, cur=C, j="jev", m=IR, dir="inc", rp=None, rows=cp(CROWS) + [cp(CROWS[3])], sel=[])
    assert not r["ok"] and any("ambiguous" in p["why"] for p in r["problems"])
    # relabelled after the run -> changed, refuse
    ed = cp(CROWS); ed[3]["human_intent_resolution"] = 1
    r = run(base=B, cur=C, j="jev", m=IR, dir="inc", rp=[0, 1, 2, 3, 4, 5], rows=ed, sel=[])
    assert not r["ok"] and any("changed since the run" in p["why"] for p in r["problems"])
    # nothing increased -> empty (never all rows); dataset gone -> no_dataset
    flat = {**C, "results": [{**x, "jev": {IR: 1}} for x in CRES]}
    e = run(base=B, cur=flat, j="jev", m=IR, dir="inc", rp=None, rows=cp(CROWS), sel=[])
    assert e["D"]["shown"] == [] and not e["ok"] and e["reason"] == "empty"
    assert run(base=B, cur=C, j="jev", m=IR, dir="inc", rp=None, rows=[], sel=[])["reason"] == "no_dataset"


def test_app_wiring_increases_prepare_same_path_direction_bound():
    s = (ST / "app.js").read_text()
    a = s.index("// t_d258f7ec"); c = s.index("\n}\n", s.index("function rcPrepWire")); blk = s[a:c]
    assert "rcPrepHTML(r, pl({ judge: j, metric: m }), key, d) : \"\"}${body}" in s          # both signs, when shown > 0
    assert '(P.dir || "dec") === d.direction && S.pv.rc?.order === d.direction' in blk          # direction-bound validity
    assert 'runCompareChanges(now, ...key.split(":"), ord)' in blk and "dir: v.D.direction" in blk
    assert 'kind: P.dir === "inc" ? "increase" : "decrease"' in blk
    assert "not a verified improvement" in blk and "Recorded score increases" in blk and "not a confirmed regression" in blk
    for bad in ("fetch(", "api(", "runBtn", "S.rows =", "S.results =", "localStorage", "download(", "verified improvements.\" :"):
        assert bad not in blk, bad
    assert 'pn.kind === "increase" ? "recorded-increase"' in s
    assert 'if (step === "export" && S.pv?.rc?.prep) renderRunCompare();' in s              # t_d0deefc7 refresh covers it
