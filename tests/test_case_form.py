"""Guided Add case (app/static/case_form.js): required fields, labels blank/valid/invalid, special chars and
multiline kept verbatim, duplicate ids refused, cancellation (pure builder never mutates), nothing synthesized,
the row is accepted by the real Python judge input path, and JSONL/CSV export -> app import roundtrip."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from jev_foundry_judge.evaluators import SPECS, build_state  # noqa: E402

JS = ROOT / "app" / "static" / "case_form.js"
APP = ROOT / "app" / "static" / "app.js"
M4 = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def node(expr, arg):
    code = ("const CF=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
            "const a=JSON.parse(d);process.stdout.write(JSON.stringify((" + expr + ")(CF,a)))})")
    out = subprocess.run(["node", "-e", code, str(JS)], input=json.dumps(arg), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def build(form, ids=()):
    return node("(CF,a)=>CF.buildCase(a.f,a.ids)", {"f": form, "ids": list(ids)})


BASE = {"id": "my-case-1", "request": "Where is my parcel?", "answer": "It ships Friday.", "context": "", "labels": {}}


def test_required_fields():
    r = build({"id": " ", "request": "  \n", "answer": "", "context": "", "labels": {}})
    assert r["ok"] is False and set(r["errors"]) == {"id", "request", "answer"}
    assert build(BASE)["ok"] is True


def test_minimal_row_is_canonical_and_nothing_synthesized():
    row = build(BASE)["row"]
    assert row["query"] == [{"role": "user", "content": "Where is my parcel?"}]
    assert row["response"] == [{"role": "assistant", "content": [{"type": "text", "text": "It ships Friday."}]}]
    assert row["source"] == "user-authored" and row["scenario"] == "user_authored"
    for k in ("context", "tool_definitions", "tool_calls", "generated", *[f"human_{m}" for m in M4]):
        assert k not in row
    st = build_state(**{k: row.get(k) for k in ("query", "response", "tool_definitions", "tool_calls", "context")})
    assert st["agent_final_answer"] == "It ships Friday." and "agent_tool_calls" not in st
    # honest: no tools/context -> TC and GR are not scored rather than invented
    assert [m for m in M4 if SPECS[m]["requires"](st)] == ["intent_resolution", "task_adherence"]


def test_context_enables_groundedness_only_when_typed():
    row = build({**BASE, "context": "Policy: parcels ship Fridays."})["row"]
    st = build_state(query=row["query"], response=row["response"], context=row["context"])
    assert st["reference_context"] == "Policy: parcels ship Fridays." and SPECS["groundedness"]["requires"](st)
    assert "context" not in build({**BASE, "context": "   \n "})["row"]


@pytest.mark.parametrize("raw,ok,val", [("", True, None), (" ", True, None), ("1", True, 1), ("5", True, 5), (" 3 ", True, 3),
                                        ("0", False, None), ("6", False, None), ("3.5", False, None), ("x", False, None),
                                        ("-1", False, None), ("4e0", False, None)])
def test_labels_blank_valid_invalid(raw, ok, val):
    r = build({**BASE, "labels": {"task_adherence": raw}})
    assert r["ok"] is ok
    if ok:
        assert r["row"].get("human_task_adherence") == val and ("human_task_adherence" in r["row"]) == (val is not None)
    else:
        assert list(r["errors"]) == ["label_task_adherence"]


def test_all_labels_set():
    r = build({**BASE, "labels": {m: str(i + 1) for i, m in enumerate(M4)}})["row"]
    assert [r[f"human_{m}"] for m in M4] == [1, 2, 3, 4]


SPECIAL = 'Line 1\nLine "2" <script>alert(1)</script> & \u2028 café 🚀,comma\r\n\tend  '


def test_special_chars_multiline_verbatim():
    row = build({**BASE, "request": SPECIAL, "answer": SPECIAL, "context": SPECIAL})["row"]
    assert row["query"][0]["content"] == SPECIAL and row["response"][0]["content"][0]["text"] == SPECIAL
    assert row["context"] == SPECIAL


def test_duplicate_id_refused_not_overwritten():
    r = build({**BASE, "id": " sup-01 "}, ids=["sup-01", "x"])
    assert r["ok"] is False and "already exists" in r["errors"]["id"]
    assert build({**BASE, "id": "sup-01b"}, ids=["sup-01"])["ok"] is True
    assert build({**BASE, "id": "a"}, ids=[" a "])["ok"] is False      # existing ids compared trimmed
    assert build({**BASE, "id": "7"}, ids=[7])["ok"] is False           # numeric ids from uploads


def test_suggest_id_stable_and_free():
    assert node("(CF,a)=>CF.suggestId(a)", []) == "my-case-1"
    assert node("(CF,a)=>CF.suggestId(a)", ["my-case-1", "my-case-3", 7]) == "my-case-2"


def test_builder_pure_cancel_leaves_dataset_unchanged():
    # buildCase never receives or mutates the dataset (only ids); Cancel in the UI just removes the dialog.
    out = node("(CF,a)=>{const ids=a.map(r=>r.id);const before=JSON.stringify(a);CF.buildCase({id:'n',request:'q',answer:'a',labels:{}},ids);"
               "CF.buildCase({id:'',request:'',answer:''},ids);return JSON.stringify(a)===before && ids.length===a.length}",
               [{"id": "a", "query": "x"}])
    assert out is True
    src = APP.read_text()
    assert "S.rows.push(r.row)" in src and src.count("S.rows.push(r.row)") == 1
    add = src[src.index("function addCase"):src.index('$("#addCase").onclick')].replace("S.runRows.length", "")  # read-only length check allowed
    # the shared Add/Edit form may READ S.results.length (to explain reruns) but never writes run state
    assert "fetch" not in add and "api(" not in add and "S.results =" not in add and "S.results.push" not in add
    assert "S.runRows" not in add and "S.selected" not in add and "S.summary" not in add


def test_no_network_in_builder():
    t = "\n".join(l for l in JS.read_text().splitlines() if not l.strip().startswith("//"))
    for bad in ("fetch(", "XMLHttpRequest", "sendBeacon", "localStorage", "sessionStorage", "S.key", "X-Jev-Key"):
        assert bad not in t


def _app_fns():
    """Extract the app's real export/import functions (toJSONL, toCSV, parseCSV, normalize) to run under node."""
    src = APP.read_text()
    take = lambda start, end: src[src.index(start):src.index(end, src.index(start))]
    parts = ['const M = { intent_resolution: 1, task_adherence: 1, tool_call_accuracy: 1, groundedness: 1 };',
             take("function parseCSV", "function normalize"), take("function normalize", '$("#upload")'),
             take("const toJSONL", "function flatResults")]
    return "\n".join(parts)


def test_export_import_roundtrip_jsonl_and_csv():
    rows = [build({**BASE, "request": SPECIAL, "answer": "A,\"b\"\nc", "context": "ctx\nline2",
                   "labels": {"intent_resolution": "4", "groundedness": "2"}})["row"],
            build({**BASE, "id": "my-case-2"})["row"],
            build({**BASE, "id": "json-looking-ctx", "context": '{"policy": "ship Fri"}'})["row"],
            build({**BASE, "id": "bracket-ctx", "context": "[1] Refund terms apply"})["row"]]
    code = _app_fns() + """
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const rows=JSON.parse(d);
const j=toJSONL(rows).split(/\\n/).filter(l=>l.trim()).map(l=>JSON.parse(l)).map(normalize);
const c=parseCSV(toCSV(rows.map(r=>Object.fromEntries(Object.entries(r))))).map(normalize);
process.stdout.write(JSON.stringify({j,c}))})"""
    out = json.loads(subprocess.run(["node", "-e", code], input=json.dumps(rows), capture_output=True, text=True, check=True).stdout)
    assert out["j"] == rows and json.dumps(out["j"]) == json.dumps(rows)  # byte-identical incl. key order
    assert out["c"] == rows and json.dumps(out["c"]) == json.dumps(rows)  # CSV: quoted multiline/commas/quotes, labels re-numbered, provenance kept
