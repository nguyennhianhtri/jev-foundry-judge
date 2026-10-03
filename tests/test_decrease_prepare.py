"""t_d258f7ec: prepare the Recorded score decreases (Compare with recorded run) for an explicit repeat run.
Composition only: runCompareDecreases().shown -> {pos: current_pos, id} -> prepareRerun (same binding as slow/disagreement
cases). Main case = retained REAL two-run replay (t_80f908ea live-zoom 390: real Jev run1 package rows/results + real run2);
labelled SYNTHETIC fixtures for typed ids / duplicates / stale / removed / no id."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
SRC = ROOT / "tests" / "fixtures" / "real-2run-t80f"   # verbatim copy of workspace/deliverables/t_80f908ea/live-zoom raw runs
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const RC=require(process.argv[1]),P=require(process.argv[2]);let d='';"
        "process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const b0=JSON.stringify(a);"
        "const r=RC.buildRunCompare(a.base,a.cur);const D=RC.runCompareDecreases(r,a.j,a.m);"
        "const L=D.ok?D.shown.map(x=>({pos:x.current_pos,id:x.id})):[];"
        "const o=P.prepareRerun({members:L,runRows:a.cur.rows,runPos:a.rp,rows:a.rows,selected:new Set(a.sel)});"
        "o.D=D;o.unchanged=JSON.stringify(a)===b0;process.stdout.write(JSON.stringify(o))})")
IR = "intent_resolution"


def run(**a):
    out = subprocess.run(["node", "-e", CODE, str(ST / "run_compare.js"), str(ST / "slow_prepare.js")],
                         input=json.dumps(a), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def real():
    r1 = json.loads((SRC / "390-run1-raw.json").read_text()); r2 = json.loads((SRC / "390-run2-raw.json").read_text())
    base = {"rows": r1["runRows"], "results": r1["results"], "version": "run1", "at": r1.get("at")}
    cur = {"rows": r2["runRows"], "results": r2["results"], "version": "run2", "at": r2.get("at"), "complete": True}
    return base, cur, r1, r2


def independent(r1, r2):
    strip = lambda r: json.dumps(sorted((k, r[k]) for k in r if not k.startswith("human_")))
    cnt = lambda rows, i: sum(1 for x in rows if json.dumps(x.get("id")) == json.dumps(i))
    out = []
    for ci, c in enumerate(r2["runRows"]):
        if cnt(r2["runRows"], c["id"]) != 1 or cnt(r1["runRows"], c["id"]) != 1: continue
        bi = next(i for i, x in enumerate(r1["runRows"]) if json.dumps(x["id"]) == json.dumps(c["id"]))
        if strip(r1["runRows"][bi]) != strip(c): continue
        x, y = r1["results"][bi]["jev"].get(IR), r2["results"][ci]["jev"].get(IR)
        if isinstance(x, (int, float)) and isinstance(y, (int, float)) and y - x < 0: out.append((y - x, ci, c["id"]))
    return [(ci, i) for _, ci, i in sorted(out)]


def test_real_two_run_membership_maps_current_rows_not_baseline():
    base, cur, r1, r2 = real()
    exp = independent(r1, r2)
    assert len(exp) >= 3 and {json.dumps(i) for _, i in exp} >= {"7", '"7"'}          # both typed 7s decreased (real)
    extra = {"id": "extra-unrelated", "query": "not in run"}
    rows = [extra] + json.loads(json.dumps(r2["runRows"]))                           # current dataset shifted by one
    o = run(base=base, cur=cur, j="jev", m=IR, rp=[i + 1 for i in range(len(rows) - 1)], rows=rows, sel=[0])
    assert o["unchanged"] and o["ok"]
    assert [(x["current_pos"], x["id"]) for x in o["D"]["shown"]] == exp
    assert o["after"]["positions"] == sorted(ci + 1 for ci, _ in exp)
    assert all(m["via"] == "run position" for m in o["mapped"])
    assert o["before"]["positions"] == [0] and o["removed"] == 1 and o["added"] == len(exp)
    # without run positions (retained run predates them) -> unique identical row, same answer
    o2 = run(base=base, cur=cur, j="jev", m=IR, rp=None, rows=rows, sel=[])
    assert o2["ok"] and o2["after"]["positions"] == o["after"]["positions"]


def test_real_baseline_rows_are_not_the_runnable_dataset():
    base, cur, r1, r2 = real()
    # dataset = baseline file rows: the changed-input "ctx" is never shown; the typed 7s bind only if byte-identical
    o = run(base=base, cur=cur, j="jev", m=IR, rp=None, rows=r1["runRows"], sel=[])
    assert "ctx" not in [x["id"] for x in o["D"]["shown"]]
    for m in o.get("mapped", []):
        assert json.dumps(r1["runRows"][m["at"]], sort_keys=True) == json.dumps(r2["runRows"][m["pos"]], sort_keys=True)


BROWS = [{"id": 7, "query": "q"}, {"id": "7", "query": "q2"}, {"id": "dup", "query": "d"}, {"id": "e", "query": "e"}]
BRES = [{"id": 7, "jev": {IR: 4}}, {"id": "7", "jev": {IR: 5}}, {"id": "dup", "jev": {IR: 5}}, {"id": "e", "jev": {IR: 5}}]
CROWS = [{"id": "7", "query": "q2"}, {"id": 7, "query": "q"}, {"id": "dup", "query": "d"}, {"id": "e", "query": "e"}]
CRES = [{"id": "7", "jev": {IR: 3}}, {"id": 7, "jev": {IR: 3}}, {"id": "dup", "jev": {IR: 1}}, {"id": "e", "jev": {IR: 5}}]
B = {"rows": BROWS, "results": BRES, "version": "vB"}
C = {"rows": CROWS, "results": CRES, "version": "vC", "complete": True}


def test_typed_ids_ambiguous_stale_removed_empty_no_dataset():
    ok = run(base=B, cur=C, j="jev", m=IR, rp=[0, 1, 2, 3], rows=json.loads(json.dumps(CROWS)), sel=[3])
    assert ok["ok"] and [x["id"] for x in ok["D"]["shown"]] == ["dup", "7", 7] and ok["after"]["ids"] == ["7", 7, "dup"]
    # "7" text row can never stand in for 7 number
    r = run(base=B, cur=C, j="jev", m=IR, rp=None, rows=[CROWS[0], {"id": "7", "query": "q"}, CROWS[2], CROWS[3]], sel=[3])
    assert not r["ok"] and any(p["id"] == 7 and "no longer in the dataset" in p["why"] for p in r["problems"])
    # an identical copy, no run positions -> ambiguous refuse
    r = run(base=B, cur=C, j="jev", m=IR, rp=None, rows=CROWS + [dict(CROWS[2])], sel=[3])
    assert not r["ok"] and any("ambiguous" in p["why"] for p in r["problems"])
    # relabel after run -> stale refuse
    ed = json.loads(json.dumps(CROWS)); ed[1]["human_intent_resolution"] = 1
    r = run(base=B, cur=C, j="jev", m=IR, rp=[0, 1, 2, 3], rows=ed, sel=[3])
    assert not r["ok"] and "changed since the run" in r["problems"][0]["why"] and r["before"]["positions"] == [3]
    # no decreases -> empty; no dataset -> no_dataset
    same = {"rows": CROWS, "results": CRES, "version": "vB"}
    assert run(base=same, cur=C, j="jev", m=IR, rp=None, rows=CROWS, sel=[])["reason"] == "empty"
    assert run(base=B, cur=C, j="jev", m=IR, rp=None, rows=[], sel=[])["reason"] == "no_dataset"


def test_app_wiring_one_mechanism_never_runs():
    s = (ST / "app.js").read_text()
    a = s.index("// t_d258f7ec"); b = s.index("function rcPrepWire"); c = s.index("\n}\n", s.index("function rcPrepWire"))
    blk = s[a:c]
    assert "prepareRerun(" in blk and "runCompareChanges(" in blk and "prepSig()" in blk   # t_3e9f0c98: shown sign
    for bad in ("fetch(", "api(", "runBtn", "S.rows =", "S.results =", "localStorage", "download("):
        assert bad not in blk, bad
    assert 'go("run")' in blk and "#rsSel" in blk and '"increase" : "decrease"' in blk
    assert "rcPrepWire(box)" in s and "not a confirmed regression" in blk and "not an accuracy gain" in blk
    assert "recorded versions: baseline" in blk and "not the baseline file" in blk
