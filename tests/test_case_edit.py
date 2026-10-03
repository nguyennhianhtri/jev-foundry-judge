"""Guided Edit (app/static/case_form.js editEligibility/formFromRow/applyEdit + app.js wiring): simple rows
editable through the same form; rich tool / multi-message traces JSON-only; exact whitespace; blank labels;
provenance/unknown fields and key order kept; id uniqueness; purity (Cancel/invalid change nothing); stale
guard; frozen run snapshot never touched; export/import roundtrip of edited rows."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "app" / "static" / "case_form.js"
APP = ROOT / "app" / "static" / "app.js"
M4 = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def node(expr, arg):
    code = ("const CF=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
            "const a=JSON.parse(d);process.stdout.write(JSON.stringify((" + expr + ")(CF,a)))})")
    out = subprocess.run(["node", "-e", code, str(JS)], input=json.dumps(arg), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def elig(row):
    return node("(CF,a)=>CF.editEligibility(a)", row)


def edit(row, form, ids=()):
    return node("(CF,a)=>{const before=JSON.stringify(a.row);const r=CF.applyEdit(a.row,a.f,a.ids);"
                "return {...r, untouched: JSON.stringify(a.row)===before}}", {"row": row, "f": form, "ids": list(ids)})


def form_of(row):
    return node("(CF,a)=>CF.formFromRow(a)", row)


AUTH = {"id": "my-case-1", "scenario": "user_authored",
        "query": [{"role": "user", "content": "  Where is\n my parcel?  "}],
        "response": [{"role": "assistant", "content": [{"type": "text", "text": "It ships Friday.\t"}]}],
        "context": "Policy: Fridays.", "human_intent_resolution": 4,
        "note": "user-authored in the browser (not an observed agent trace; no tool calls)", "source": "user-authored"}
SAMPLE = {"id": "sup-01", "scenario": "customer_support", "query": "plain string q", "response": "plain string a",
          "x_custom": {"keep": [1, 2]}, "generated": True, "human_task_adherence": 2}
RICH = {"id": "tool-01", "query": [{"role": "system", "content": "sys"}, {"role": "user", "content": "q"}],
        "response": [{"role": "assistant", "content": [{"type": "tool_call", "tool_call_id": "c1", "name": "f", "arguments": {}}]},
                     {"role": "tool", "tool_call_id": "c1", "content": [{"type": "tool_result", "tool_result": {"ok": 1}}]},
                     {"role": "assistant", "content": [{"type": "text", "text": "done"}]}],
        "tool_definitions": [{"name": "f"}]}


def test_eligibility_simple_vs_rich():
    assert elig(AUTH)["ok"] and elig(SAMPLE)["ok"]
    assert elig({**AUTH, "response": [{"role": "assistant", "content": "str"}]})["ok"]
    r = elig(RICH)
    assert r["ok"] is False and "JSON editor" in r["reason"]
    for bad in ({**AUTH, "query": RICH["query"]},                                        # multi-message request
                {**AUTH, "response": RICH["response"]},                                  # tool trace
                {**AUTH, "response": [{"role": "assistant", "content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]}]},
                {**AUTH, "response": [{"role": "assistant", "content": "a", "tool_calls": [{}]}]},  # extra msg key
                {**AUTH, "query": [{"role": "user", "content": "q", "name": "bob"}]},    # extra msg key would be kept but hidden
                {**AUTH, "tool_definitions": [{"name": "f"}]},
                {**AUTH, "context": {"doc": "x"}},                                       # structured context
                {**AUTH, "human_task_adherence": 3.5}, {**AUTH, "human_task_adherence": 7},
                {**AUTH, "id": 7}, {**AUTH, "id": " "}):
        assert elig(bad)["ok"] is False, bad
    # rich rows are refused by applyEdit too (never flattened even if called directly)
    r = edit(RICH, {"id": "tool-01", "request": "q", "answer": "done", "context": "", "labels": {}})
    assert r["ok"] is False and r["untouched"]


def test_form_prefill_exact():
    f = form_of(AUTH)
    assert f["request"] == "  Where is\n my parcel?  " and f["answer"] == "It ships Friday.\t" and f["context"] == "Policy: Fridays."
    assert f["labels"] == {"intent_resolution": "4", "task_adherence": "", "tool_call_accuracy": "", "groundedness": ""}


def test_noop_save_is_byte_identical():
    for row in (AUTH, SAMPLE, {**AUTH, "context": "   "}):
        r = edit(row, form_of(row))
        assert r["ok"] and r["changed"] is False and json.dumps(r["row"]) == json.dumps(row) and r["untouched"]


def test_edit_changes_only_edited_fields_and_keeps_everything_else():
    f = form_of(AUTH)
    f.update(request="New ask\n  with spaces  ", answer=" A,\"b\"\r\nc ", context="",
             labels={"intent_resolution": "", "task_adherence": "5", "tool_call_accuracy": " ", "groundedness": "2"})
    r = edit(AUTH, f, ids=["other"])
    assert r["ok"] and r["changed"] and r["untouched"]
    row = r["row"]
    assert row["query"] == [{"role": "user", "content": "New ask\n  with spaces  "}]
    assert row["response"][0]["content"][0]["text"] == " A,\"b\"\r\nc "
    assert "context" not in row and "human_intent_resolution" not in row
    assert row["human_task_adherence"] == 5 and row["human_groundedness"] == 2 and "human_tool_call_accuracy" not in row
    assert row["source"] == "user-authored" and row["note"] == AUTH["note"] and row["scenario"] == "user_authored"
    assert list(row) == ["id", "scenario", "query", "response", "human_task_adherence", "human_groundedness", "note", "source"]


def test_string_shapes_and_unknown_fields_preserved():
    f = form_of(SAMPLE); f.update(answer="better answer", context="ctx text", labels={**f["labels"], "task_adherence": "4"})
    r = edit(SAMPLE, f)["row"]
    assert r["query"] == "plain string q" and r["response"] == "better answer"   # shape preserved, not converted
    assert r["x_custom"] == {"keep": [1, 2]} and r["generated"] is True and "source" not in r
    assert r["context"] == "ctx text" and r["human_task_adherence"] == 4
    assert list(r) == ["id", "scenario", "query", "response", "context", "x_custom", "generated", "human_task_adherence"]


def test_id_rules():
    f = form_of(AUTH)
    assert edit(AUTH, {**f, "id": "sup-01"}, ids=["sup-01"])["errors"]["id"].startswith("A row with ID")
    assert edit(AUTH, {**f, "id": " sup-01 "}, ids=["sup-01"])["ok"] is False
    assert edit(AUTH, {**f, "id": ""}, ids=[])["ok"] is False
    r = edit(AUTH, {**f, "id": "  renamed "}, ids=["sup-01"])
    assert r["ok"] and r["row"]["id"] == "renamed"
    # keeping its own id is never a "duplicate" of itself, and stays byte-exact
    odd = {**AUTH, "id": "keep me "}
    assert edit(odd, form_of(odd), ids=["x"])["row"]["id"] == "keep me "


def test_invalid_input_changes_nothing():
    f = form_of(AUTH)
    for bad in ({**f, "request": "  "}, {**f, "answer": ""}, {**f, "labels": {**f["labels"], "groundedness": "9"}},
                {**f, "context": "x" * 20001}):
        r = edit(AUTH, bad)
        assert r["ok"] is False and r["untouched"] and "row" not in r


def _app_fns():
    src = APP.read_text()
    take = lambda start, end: src[src.index(start):src.index(end, src.index(start))]
    return "\n".join(['const M = { intent_resolution: 1, task_adherence: 1, tool_call_accuracy: 1, groundedness: 1 };',
                      take("function parseCSV", "function normalize"), take("function normalize", '$("#upload")'),
                      take("const toJSONL", "function flatResults")])


def test_edited_rows_export_import_roundtrip():
    f = form_of(AUTH); f.update(answer="Edited\n\"answer\", ok", labels={**f["labels"], "groundedness": "3"})
    rows = [edit(AUTH, f)["row"]]
    code = f"const CF=require({json.dumps(str(JS))});" + _app_fns() + """
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const rows=JSON.parse(d);
const j=toJSONL(rows).split(/\\n/).filter(l=>l.trim()).map(l=>JSON.parse(l)).map(normalize);
const c=parseCSV(toCSV(rows)).map(normalize);
process.stdout.write(JSON.stringify({j,c,ej:CF.editEligibility(j[0]).ok}))})"""
    out = json.loads(subprocess.run(["node", "-e", code], input=json.dumps(rows), capture_output=True, text=True, check=True).stdout)
    assert json.dumps(out["j"]) == json.dumps(rows) and json.dumps(out["c"]) == json.dumps(rows) and out["ej"]


def test_app_wiring_guards():
    src = APP.read_text()
    form = src[src.index("function openCaseForm"):src.index("function addCase()")].replace("S.runRows.length", "")
    assert "fetch" not in form and "api(" not in form and "S.runRows" not in form and "S.summary" not in form
    assert "S.results =" not in form and "S.selected" not in form
    assert "editEligibility(orig)" in form and "editRow(editIdx, el.reason)" in form          # rich -> JSON editor
    assert "S.rows.indexOf(orig)" in form and "!== origJSON" in form                          # stale guard
    js = src[src.index("function editRow"):src.index("// ---------- guided Add")]
    assert "S.rows.indexOf(orig)" in js and "!== origJSON" in js                              # JSON editor stale guard too
    assert "S.runRows = structuredClone(rr.rows)" in src                                        # run snapshot is a deep copy


def test_blank_request_or_answer_rows_go_to_json():
    assert elig({**AUTH, "query": "   "})["ok"] is False
    assert elig({**AUTH, "response": [{"role": "assistant", "content": ""}]})["ok"] is False


def test_context_whitespace_rules():
    ws = {**AUTH, "context": "  \n "}
    assert edit(ws, form_of(ws))["row"]["context"] == "  \n "                 # untouched: kept byte-exact
    r = edit(AUTH, {**form_of(AUTH), "context": "   "})["row"]                  # edited to blank: removed
    assert "context" not in r
    r = edit(AUTH, {**form_of(AUTH), "context": " new\n ctx "})["row"]
    assert r["context"] == " new\n ctx "


def test_rerun_notice_bookkeeping():
    src = APP.read_text()
    assert 'S.editedSinceRun.delete(String(S.rows[i].id)); S.rows.splice(i, 1)' in src   # delete clears notice
    assert "if (!S.runRows.length) return;" in src                                         # mid-run edits flagged
    assert "/^[1-5]$/.test(raw)" in src                                                    # inline labels whole 1-5
