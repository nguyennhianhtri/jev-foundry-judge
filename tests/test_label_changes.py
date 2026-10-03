"""Session label-change export (sessionChanges/changesPacket)."""
import json, shutil, subprocess
from pathlib import Path
import pytest

JS = Path(__file__).resolve().parents[1] / "app" / "static" / "label_coverage.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def run(body):
    code = "const L=require(process.argv[1]);const out=(()=>{" + body + "})();process.stdout.write(JSON.stringify(out))"
    return json.loads(subprocess.run(["node", "-e", code, str(JS)], capture_output=True, text=True, check=True).stdout)


SETUP = ("const rows=[{id:'a',query:'q',response:'x',human_intent_resolution:2,zz:{u:1}},"
         "{id:'b',query:'q',response:'x'},{id:'c',query:'q',response:'x',human_task_adherence:4},{id:'b',query:'z',response:'y'}];"
         "const base=new Map();const save=(r,ch)=>{const rec=L.captureSave(r);if(!base.has(r))base.set(r,L.labelSig(r));"
         "for(const[m,v]of Object.entries(ch)){if(v==null)delete r['human_'+m];else r['human_'+m]=v;}return L.sealSave(rec);};")


def test_blank_to_score_score_to_blank_and_multi_row():
    o = run(SETUP + "save(rows[1],{intent_resolution:3});save(rows[2],{task_adherence:null,groundedness:5});save(rows[0],{intent_resolution:2});"
            "const snap=JSON.stringify(rows);const p=L.changesPacket(rows,base,{version:'v',at:'t'});return {p,same:JSON.stringify(rows)===snap}")
    p = o["p"]
    assert o["same"] and p["cases_changed"] == 2 and p["label_changes"] == 3
    assert p["cases"][0] == {"row_index": 1, "id": "b", "changes": [{"metric": "intent_resolution", "before": {"present": False}, "after": {"present": True, "value": 3}}]}
    c = {x["metric"]: x for x in p["cases"][1]["changes"]}
    assert c["task_adherence"]["before"] == {"present": True, "value": 4} and c["task_adherence"]["after"] == {"present": False}
    assert c["groundedness"]["before"] == {"present": False}
    s = json.dumps(p)
    assert "query" not in s and "zz" not in s and "response" not in s


def test_noop_undo_and_net_zero_excluded():
    o = run(SETUP + "const s=save(rows[1],{intent_resolution:3});L.undoSave(rows,s);save(rows[2],{task_adherence:5});save(rows[2],{task_adherence:4});"
            "return L.sessionChanges(rows,base)")
    assert o == []


def test_replaced_deleted_and_duplicate_id_not_misattributed():
    o = run(SETUP + "save(rows[1],{intent_resolution:3});save(rows[0],{intent_resolution:5});rows[0]=structuredClone(rows[0]);"
            "return L.sessionChanges(rows,base)")
    assert len(o) == 1 and o[0]["row_index"] == 1 and o[0]["id"] == "b"
    o = run(SETUP + "save(rows[3],{groundedness:1});rows.splice(1,1);return L.sessionChanges(rows,base)")
    assert len(o) == 1 and o[0]["row_index"] == 2


def test_raw_invalid_values_kept_not_coerced():
    o = run(SETUP + "rows[0].human_groundedness='x';save(rows[0],{groundedness:2});return L.sessionChanges(rows,base)")
    assert o[0]["changes"][0]["before"] == {"present": True, "value": "x"}
