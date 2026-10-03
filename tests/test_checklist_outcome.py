"""Checklist outcome export (checklistOutcome): only explicit actions count, stale evidence is honest, counts reconcile."""
import json, shutil, subprocess
from pathlib import Path
import pytest

JS = Path(__file__).resolve().parents[1] / "app" / "static" / "label_coverage.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")

P = lambda v: {"present": True, "value": v}
A = {"present": False}
FILE = json.dumps({"kind": "jev-foundry-judge/label-session-changes", "version": 1, "app_version": "v1.14", "cases": [
    {"row_index": 0, "id": "a", "changes": [{"metric": "intent_resolution", "before": A, "after": P(3)}]},
    {"id": "b", "changes": [{"metric": "intent_resolution", "before": A, "after": P(4)}]},
    {"id": 7, "changes": [{"metric": "task_adherence", "before": A, "after": P(5)}]},
    {"id": "gone", "changes": [{"metric": "task_adherence", "before": A, "after": P(1)}]},
    {"id": "d", "changes": [{"metric": "task_adherence", "before": A, "after": P(2)}]},
    {"id": None, "changes": []},
]})
SETUP = ("const L=require(process.argv[1]);const rows=[{id:'a',query:'q',response:'x',human_intent_resolution:3},"
         "{id:'b',query:'q',response:'x'},{id:'d',query:'q',response:'1'},{id:'d',query:'q',response:'2'},"
         f"{{id:7,query:'q',response:'x',human_task_adherence:5}}];const p=L.parseChangesFile({json.dumps(FILE)});"
         "const chk={name:'f.json',meta:p.meta,items:p.items,skipped:new Set(),acts:new Map()};"
         "const act=(k,a,r,m)=>chk.acts.set(k,{action:a,at:'T',row:r,sig:JSON.stringify(r),value:Object.hasOwn(r,'human_'+m)?{present:true,value:r['human_'+m]}:{present:false}});")


def run(body):
    code = SETUP + "const out=(()=>{" + body + "})();process.stdout.write(JSON.stringify(out,(k,v)=>k==='row'?undefined:v))"
    return json.loads(subprocess.run(["node", "-e", code, str(JS)], capture_output=True, text=True, check=True).stdout)


def test_nothing_done_is_not_reviewed_even_when_matching():
    o = run("return L.checklistOutcome(rows,chk,{version:'v',at:'now'})")
    assert o["outcome_counts"] == {"saved": 0, "confirmed": 0, "skipped": 0, "not_reviewed": 6}
    assert o["status_counts"] == {"matched": 2, "drifted": 1, "missing": 1, "ambiguous": 1, "invalid": 1}
    assert o["entries"][0]["current_status"] == "matched" and o["entries"][0]["outcome"] == "not_reviewed"
    assert o["entries_total"] == len(o["entries"]) == sum(o["outcome_counts"].values()) == sum(o["status_counts"].values())


def test_explicit_actions_skip_and_absent_vs_number_and_no_traces():
    o = run("chk.skipped.add(0);act(1,'saved',rows[1],'intent_resolution');act(2,'confirmed',rows[4],'task_adherence');"
            "chk.skipped.add(3);const snap=JSON.stringify(rows);const r=L.checklistOutcome(rows,chk);r.same=JSON.stringify(rows)===snap;return r")
    e = o["entries"]
    assert [x["outcome"] for x in e] == ["skipped", "saved", "confirmed", "skipped", "not_reviewed", "not_reviewed"]
    assert e[1]["outcome_label"] == A and e[1]["current_label"] == A and e[1]["evidence"] == "current"   # saved blank stays blank
    assert e[2]["id"] == 7 and e[2]["outcome_label"] == P(5)
    assert o["same"] and o["evidence_counts"] == {"current": 2, "stale": 0}
    s = json.dumps(o)
    assert "query" not in s and '"response"' not in s and "row_index" not in s


@pytest.mark.parametrize("mut,note", [
    ("rows[1].human_intent_resolution=2", "changed"),
    ("rows.splice(1,1)", "removed or replaced"),
    ("rows[1]={...rows[1]}", "removed or replaced"),
    ("rows.push({id:'b',query:'q',response:'z'})", "now ambiguous"),
])
def test_stale_evidence_after_edit_delete_replace_duplicate(mut, note):
    o = run(f"act(1,'saved',rows[1],'intent_resolution');{mut};return L.checklistOutcome(rows,chk)")
    e = o["entries"][1]
    assert e["outcome"] == "saved" and e["evidence"] == "stale" and note in e["evidence_note"]
    assert o["evidence_counts"]["stale"] == 1
