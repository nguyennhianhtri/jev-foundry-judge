"""Label-pass session progress + Undo last save (labelSig/captureSave/sealSave/undoSave/sessionProgress)."""
import json, shutil, subprocess
from pathlib import Path
import pytest

JS = Path(__file__).resolve().parents[1] / "app" / "static" / "label_coverage.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def run(body):
    code = "const L=require(process.argv[1]);const out=(()=>{" + body + "})();process.stdout.write(JSON.stringify(out))"
    return json.loads(subprocess.run(["node", "-e", code, str(JS)], capture_output=True, text=True, check=True).stdout)


SETUP = ("const rows=[{id:'a',query:'q',response:'x',human_intent_resolution:2,zz:{u:1},source:'user-authored'},"
         "{id:'a',query:'q',response:'x'},{id:'c',query:'q',response:'x',human_task_adherence:4,human_intent_resolution:5}];"
         "const base=new Map();const save=(r,ch)=>{const rec=L.captureSave(r);if(!base.has(r))base.set(r,L.labelSig(r));"
         "for(const[m,v]of Object.entries(ch)){if(v==null)delete r['human_'+m];else r['human_'+m]=v;}return L.sealSave(rec);};")


def test_undo_restores_exact_prior_incl_absent_keys_and_order():
    o = run(SETUP + "const before=JSON.stringify(rows[0]);const s=save(rows[0],{intent_resolution:4,task_adherence:3});"
            "const mid=L.sessionProgress(rows,base);const u=L.undoSave(rows,s);"
            "return {before,after:JSON.stringify(rows[0]),mid,u,end:L.sessionProgress(rows,base)}")
    assert o["after"] == o["before"] and o["u"] == {"ok": True, "idx": 0}
    assert o["mid"]["changed"] == 1 and o["end"]["changed"] == 0


def test_noop_save_not_counted_and_not_undoable():
    o = run(SETUP + "const s=save(rows[2],{});return {s,p:L.sessionProgress(rows,base)}")
    assert o["s"] is None and o["p"]["changed"] == 0


def test_stale_and_deleted_and_duplicate_id_refused_untouched():
    o = run(SETUP + "const s=save(rows[1],{intent_resolution:3});rows[1].human_task_adherence=2;const snap=JSON.stringify(rows);"
            "const u1=L.undoSave(rows,s);const same=JSON.stringify(rows)===snap;"
            "const s2=save(rows[0],{intent_resolution:1});const repl=structuredClone(rows[0]);rows[0]=repl;"   # import/JSON edit replaces object
            "const snap2=JSON.stringify(rows);const u2=L.undoSave(rows,s2);"
            "return {u1,same,u2,same2:JSON.stringify(rows)===snap2}")
    assert o["u1"]["ok"] is False and "changed" in o["u1"]["reason"] and o["same"]
    assert o["u2"]["ok"] is False and "removed" in o["u2"]["reason"] and o["same2"]


def test_blank_delete_then_undo_puts_key_back_in_place():
    o = run(SETUP + "const b=JSON.stringify(rows[2]);const s=save(rows[2],{task_adherence:null});const mid=JSON.stringify(rows[2]);"
            "L.undoSave(rows,s);return {b,mid,a:JSON.stringify(rows[2])}")
    assert "task_adherence" not in o["mid"] and o["a"] == o["b"]
