"""t_aaccd0fb: Download evaluated dataset (.jsonl) = exact frozen S.runRows of a completed run, never S.rows.
Covers readiness (before run / partial / cleared / misaligned), byte-exactness vs the frozen snapshot after later
working-dataset edits/deletes/additions, typed ids + order + unknown fields + provenance, key refusal, and the
roundtrip through the app's real import (normalize)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
APP = ST / "app.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")

FROZEN = [
    {"id": 7, "scenario": "refund", "query": "Refund?", "response": [{"role": "assistant", "content": [{"type": "tool_call", "tool_call_id": "c1", "name": "lookup", "arguments": {"order": 9}}]}],
     "tool_definitions": [{"name": "lookup"}], "human_intent_resolution": 4, "custom_meta": {"k": None, "n": "9"}, "generated": True},
    {"id": "7", "scenario": "refund", "query": "Same id, string", "response": "ok", "source": "user-authored",
     "derived_from": {"id": 7, "root": 7}, "note": "variant"},
    {"id": "no-labels", "scenario": "uploaded", "query": "q", "response": "r", "context": "ctx\nline2 \"quoted\""},
    # explicit nulls as the shipped samples/replay carry them: unrecorded label / no tools must survive re-import
    {"id": "nulls", "scenario": "rag_qa", "query": "q", "response": "r", "tool_definitions": None,
     "human_intent_resolution": 5, "human_tool_call_accuracy": None},
]


def node(code, payload):
    out = subprocess.run(["node", "-e", code, str(ST / "evaluated_dataset.js")], input=json.dumps(payload),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


BUILD = ("const {buildEvaluatedDataset}=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>"
         "{const a=JSON.parse(d);process.stdout.write(JSON.stringify(buildEvaluatedDataset(a)))})")


def res(rows):
    return [{"id": r["id"], "jev": {}} for r in rows]


SUMMARY = {"version": "v1.30.0-test", "at": "2026-09-27T12:00:00Z", "rows": 3}


def test_ready_export_is_exact_frozen_bytes_in_order():
    o = node(BUILD, {"runRows": FROZEN, "results": res(FROZEN), "summary": SUMMARY})
    assert o["ok"] and o["rows"] == 4 and o["version"] == "v1.30.0-test" and o["at"] == SUMMARY["at"]
    lines = o["text"].split("\n")
    assert lines[-1] == "" and len(lines) == 5
    parsed = [json.loads(x) for x in lines[:-1]]
    assert parsed == FROZEN
    assert [type(p["id"]) for p in parsed] == [int, str, str, str]  # typed ids kept, 7 != "7"
    # byte-exact vs JS JSON.stringify of the snapshot (compact, key order kept)
    assert o["text"] == "".join(json.dumps(r, separators=(",", ":"), ensure_ascii=False) + "\n" for r in FROZEN)
    assert "score" not in o["text"] and "jev" not in json.loads(lines[0])


@pytest.mark.parametrize("payload,reason", [
    ({"runRows": [], "results": [], "summary": None}, "no_run"),                     # before run / after Clear
    ({"runRows": FROZEN, "results": [], "summary": None}, "running_or_none"),        # run just started
    ({"runRows": FROZEN, "results": res(FROZEN)[:1], "summary": None}, "partial"),   # mid-run
    ({"runRows": FROZEN, "results": res(FROZEN)[:2], "summary": SUMMARY}, "partial"),
    ({"runRows": FROZEN, "results": list(reversed(res(FROZEN))), "summary": SUMMARY}, "misaligned"),
])
def test_not_ready_states(payload, reason):
    o = node(BUILD, payload)
    assert o == {**o, "ok": False, "reason": reason} and "text" not in o


def test_key_text_in_rows_is_refused():
    rows = [{**FROZEN[2], "note": "pasted jev_sk_SECRET123 by mistake"}]
    o = node(BUILD, {"runRows": rows, "results": res(rows), "summary": SUMMARY, "key": "jev_sk_SECRET123"})
    assert o["ok"] is False and o["reason"] == "key_in_rows"


def test_later_working_edits_do_not_change_frozen_export_and_import_roundtrips():
    """Mirror the app: runRows = structuredClone(rows) at run start, then edit/delete/add in S.rows."""
    src = APP.read_text()
    take = lambda a, b: src[src.index(a):src.index(b, src.index(a))]
    fns = "\n".join(['const M = { intent_resolution: 1, task_adherence: 1, tool_call_accuracy: 1, groundedness: 1 };',
                     take("function normalize", '$("#upload")'), take("const toJSONL", "function toCSV")])
    code = fns + """
const {buildEvaluatedDataset}=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
const S={rows:JSON.parse(d)}; S.runRows=structuredClone(S.rows); const before=toJSONL(S.runRows);
const results=S.runRows.map(r=>({id:r.id})); const summary={version:'v',at:'t'};
S.rows[0].query='EDITED'; S.rows[0].human_intent_resolution=1; S.rows.splice(1,1); S.rows.push({id:'new',query:'x',response:'y'});
const e=buildEvaluatedDataset({runRows:S.runRows,results,summary});
const cur=toJSONL(S.rows);
const back=e.text.split(/\\n/).filter(l=>l.trim()).map(l=>JSON.parse(l)).map(normalize);
process.stdout.write(JSON.stringify({same:e.text===before,differs:cur!==e.text,back}))})"""
    out = subprocess.run(["node", "-e", code, str(ST / "evaluated_dataset.js")], input=json.dumps(FROZEN),
                         capture_output=True, text=True, check=True)
    o = json.loads(out.stdout)
    assert o["same"] and o["differs"]
    # import keeps every evaluated field + typed value (existing normalize may reorder keys like note/source; values equal)
    assert o["back"] == FROZEN and [type(r["id"]) for r in o["back"]] == [int, str, str, str]


def test_ui_wiring_uses_frozen_rows_only_and_discloses():
    src = APP.read_text()
    fn = src[src.index("function evalExport"):src.index("function renderSnippet")]
    assert "S.runRows" in fn and "runRows: S.rows" not in fn
    assert "S.rows =" not in fn and "S.runRows =" not in fn and "/api/" not in fn  # no overwrite, no network
    html = (ST / "index.html").read_text()
    card = html[html.index('id="evalCard"'):html.index('id="briefCard"')]
    assert "Contains case text and tool data" in card
    # t_1ab27b73: the per-card "saved to your device only / no key" boilerplate is stated once for the whole Export step
    assert "All files save locally; none include your key" in html[html.index('id="s-export"'):]
    assert 'id="exEvalJ"' in card and "Current dataset" in html
    assert html.index("evaluated_dataset.js") < html.index("/static/app.js")


def test_export_cards_keep_titles_and_no_template_leaks():
    # t_1ab27b73: guard against regex backreference leaks when trimming copy
    html = (ST / "index.html").read_text()
    assert "\\g<" not in html and "\\1" not in html
    for t in ("Evaluated dataset (last completed run)", "Benchmark package (last completed run)", "Open benchmark package", "Benchmark brief"):
        assert f"<b>{t}</b>" in html
