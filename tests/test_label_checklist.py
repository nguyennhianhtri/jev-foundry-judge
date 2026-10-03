"""Label-changes file as a review checklist (parseChangesFile/resolveItem/buildChecklist). Read-only, never applies."""
import json, shutil, subprocess
from pathlib import Path
import pytest

JS = Path(__file__).resolve().parents[1] / "app" / "static" / "label_coverage.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def run(body):
    code = "const L=require(process.argv[1]);const out=(()=>{" + body + "})();process.stdout.write(JSON.stringify(out,(k,v)=>k==='row'?undefined:v))"
    return json.loads(subprocess.run(["node", "-e", code, str(JS)], capture_output=True, text=True, check=True).stdout)


P = lambda v: {"present": True, "value": v}
A = {"present": False}


def pkt(cases, **kw):
    return json.dumps({"kind": "jev-foundry-judge/label-session-changes", "version": 1, "cases": cases, **kw})


ROWS = ("const rows=[{id:'a',query:'q',response:'x',human_intent_resolution:3},{id:'b',query:'q',response:'x'},"
        "{id:'d',query:'q',response:'1'},{id:'d',query:'q',response:'2'},{id:7,query:'q',response:'x',human_task_adherence:5}];")


@pytest.mark.parametrize("text,err", [
    ("nope", "not a JSON"), ("[]", "not a label-changes"), (json.dumps({"kind": "x", "version": 1, "cases": [1]}), "wrong kind"),
    (json.dumps({"kind": "jev-foundry-judge/label-session-changes", "version": 2, "cases": [1]}), "unsupported version"),
    (pkt([]), "no changed cases"), (json.dumps({"kind": "jev-foundry-judge/label-session-changes", "version": 1}), "not a list"),
])
def test_whole_file_rejected(text, err):
    o = run(f"return L.parseChangesFile({json.dumps(text)})")
    assert o["ok"] is False and err in o["error"]


def test_statuses_matched_drifted_missing_ambiguous_invalid_absent_vs_numeric():
    f = pkt([
        {"row_index": 99, "id": "a", "changes": [{"metric": "intent_resolution", "before": A, "after": P(3)},
                                                  {"metric": "groundedness", "before": P(2), "after": A}]},
        {"row_index": 0, "id": "b", "changes": [{"metric": "intent_resolution", "before": A, "after": P(4)}]},
        {"id": "gone", "changes": [{"metric": "task_adherence", "before": A, "after": P(1)}]},
        {"id": "d", "changes": [{"metric": "task_adherence", "before": A, "after": P(2)}]},
        {"id": "7", "changes": [{"metric": "task_adherence", "before": A, "after": P(5)}]},
        {"id": 7, "changes": [{"metric": "task_adherence", "before": A, "after": P("5")}]},
        {"id": None, "changes": []}, {"id": "a", "changes": [{"metric": "bogus", "before": A, "after": A}]},
        {"id": "a", "changes": [{"metric": "task_adherence", "before": {"present": True}, "after": A}]},
        "str",
    ])
    o = run(ROWS + f"const snap=JSON.stringify(rows);const p=L.parseChangesFile({json.dumps(f)});const c=L.buildChecklist(rows,p.items);"
            "return {c,same:JSON.stringify(rows)===snap}")
    assert o["same"]
    st = [(x["id"], x["metric"], x["status"]) for x in o["c"]["items"]]
    assert st[:2] == [("a", "intent_resolution", "matched"), ("a", "groundedness", "matched")]   # absent == absent
    assert st[2] == ("b", "intent_resolution", "drifted") and o["c"]["items"][2]["current"] == A
    assert st[3][2] == "missing" and st[4][2] == "ambiguous"
    assert st[5][2] == "missing"                     # "7" string never matches numeric id 7
    assert st[6] == (7, "task_adherence", "drifted")  # "5" string != 5 number
    assert [s[2] for s in st[7:]] == ["invalid"] * 4
    assert o["c"]["counts"] == {"matched": 2, "drifted": 2, "missing": 2, "ambiguous": 1, "invalid": 4} and o["c"]["reviewable"] == 4
    assert o["c"]["items"][0]["idx"] == 0            # row_index 99 ignored


def test_duplicate_entries_both_invalid():
    f = pkt([{"id": "a", "changes": [{"metric": "intent_resolution", "before": A, "after": P(3)}]},
             {"id": "a", "changes": [{"metric": "intent_resolution", "before": A, "after": P(2)}]}])
    o = run(ROWS + f"return L.buildChecklist(rows,L.parseChangesFile({json.dumps(f)}).items).counts")
    assert o["invalid"] == 2 and o["matched"] == 0


def test_drift_after_edit_delete_reorder_resolved_live():
    f = pkt([{"id": "a", "changes": [{"metric": "intent_resolution", "before": A, "after": P(3)}]},
             {"id": "b", "changes": [{"metric": "intent_resolution", "before": A, "after": A}]}])
    o = run(ROWS + f"const it=L.parseChangesFile({json.dumps(f)}).items;const r1=L.buildChecklist(rows,it).counts;"
            "rows.reverse();const r2=L.buildChecklist(rows,it).items.map(x=>[x.status,x.idx]);"
            "rows.find(r=>r.id==='a').human_intent_resolution=1;const r3=L.buildChecklist(rows,it).items[0].status;"
            "rows.splice(rows.findIndex(r=>r.id==='a'),1);const r4=L.buildChecklist(rows,it).items[0].status;"
            "rows.push({id:'b'});const r5=L.buildChecklist(rows,it).items[1].status;return {r1,r2,r3,r4,r5}")
    assert o["r1"]["matched"] == 2
    assert o["r2"] == [["matched", 4], ["matched", 3]]
    assert (o["r3"], o["r4"], o["r5"]) == ("drifted", "missing", "ambiguous")


def test_parse_keeps_no_traces_or_row_index():
    f = pkt([{"row_index": 0, "id": "a", "trace": "SECRET", "changes": [{"metric": "intent_resolution", "before": A, "after": P(3), "x": 1}]}])
    o = run(f"return L.parseChangesFile({json.dumps(f)})")
    s = json.dumps(o)
    assert "SECRET" not in s and "row_index" not in s and '"x"' not in s
