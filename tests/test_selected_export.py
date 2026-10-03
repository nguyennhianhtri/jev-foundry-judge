"""t_39302f7d: export only explicitly selected dataset cases (app/static/selected_export.js). Selected N is kept apart
from search-shown N and total; hidden-but-ticked rows are counted, never silently dropped or added; bytes use the same
serializer as the whole-dataset export; the file roundtrips through the app's REAL Upload parser to the exact cases."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
APP = ST / "app.js"
MOD = ST / "selected_export.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")

ROWS = [
    {"id": 7, "scenario": "refund", "query": "Refund?", "response": [{"role": "assistant", "content": [{"type": "tool_call", "tool_call_id": "c1", "name": "lookup", "arguments": {"order": 9}}]}],
     "tool_definitions": [{"name": "lookup"}], "human_intent_resolution": 4, "custom_meta": {"k": None, "n": "9"}, "generated": True},
    {"id": "7", "scenario": "refund", "query": "Same id, string", "response": "ok", "source": "user-authored",
     "derived_from": {"id": 7, "root": 7}, "note": "variant"},
    {"id": "ctx", "scenario": "uploaded", "query": "q", "response": "r", "context": "ctx\nline2 \"quoted\""},
    {"id": "nulls", "scenario": "rag_qa", "query": "q", "response": "r", "tool_definitions": None,
     "human_intent_resolution": 5, "human_tool_call_accuracy": None},
]


def _fns():
    src = APP.read_text()
    take = lambda a, b: src[src.index(a):src.index(b, src.index(a))]
    return "\n".join(['const M = { intent_resolution: 1, task_adherence: 1, tool_call_accuracy: 1, groundedness: 1 };',
                      take("function parseCSV", "function normalize"), take("function normalize", "// Upload -> preview"),
                      take("const toJSONL", "function flatResults")])


def run(payload, extra=""):
    code = _fns() + f"""
const X=require({json.dumps(str(MOD))});const ip=require({json.dumps(str(ST / 'import_preview.js'))});
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{{const a=JSON.parse(d);a.selected=new Set(a.selected);
const o=X.buildSelectedExport(a);{extra}process.stdout.write(JSON.stringify(o))}})"""
    out = subprocess.run(["node", "-e", code], input=json.dumps(payload), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_exports_only_selected_in_dataset_order_same_bytes_as_full_serializer():
    o = run({"rows": ROWS, "selected": [3, 0], "shown": None})
    assert o["ok"] and o["n"] == 2 and o["total"] == 4 and o["shown"] == 4 and not o["search"]
    assert o["ids"] == [7, "nulls"]  # dataset order, typed id kept
    assert o["text"] == "".join(json.dumps(r, separators=(",", ":"), ensure_ascii=False) + "\n" for r in (ROWS[0], ROWS[3]))
    assert [json.loads(x) for x in o["text"].splitlines()] == [ROWS[0], ROWS[3]]


def test_typed_ids_not_confused_and_unknown_fields_provenance_kept():
    o = run({"rows": ROWS, "selected": [1], "shown": None})
    assert o["ids"] == ["7"] and json.loads(o["text"]) == ROWS[1]


def test_search_counts_and_hidden_selected_disclosed_not_dropped():
    o = run({"rows": ROWS, "selected": [0, 2], "shown": [2, 3]})
    assert o["ok"] and o["search"] and o["shown"] == 2 and o["total"] == 4 and o["n"] == 2 and o["hidden_selected"] == 1
    assert o["ids"] == [7, "ctx"]  # ticked-but-hidden row 0 included (it is selected), unticked shown row 3 not


def test_shown_unselected_rows_never_exported():
    o = run({"rows": ROWS, "selected": [2], "shown": [0, 1, 2, 3]})
    assert o["ids"] == ["ctx"] and o["hidden_selected"] == 0


@pytest.mark.parametrize("payload,reason", [
    ({"rows": ROWS, "selected": [], "shown": None}, "none_selected"),
    ({"rows": [], "selected": [], "shown": None}, "no_rows"),
    ({"rows": ROWS, "selected": [9, -1], "shown": None}, "none_selected"),  # stale out-of-range positions ignored
])
def test_nothing_selected_refused(payload, reason):
    o = run(payload)
    assert not o["ok"] and o["reason"] == reason and "text" not in o


def test_key_text_refused():
    rows = [dict(ROWS[2], note="sk-SECRETKEY123")]
    o = run({"rows": rows, "selected": [0], "shown": None, "key": "sk-SECRETKEY123"})
    assert not o["ok"] and o["reason"] == "key_in_rows"


def test_input_not_mutated():
    o = run({"rows": ROWS, "selected": [0, 1], "shown": [1]}, extra="o.after=a.rows;o.selAfter=[...a.selected];")
    assert o["after"] == ROWS and o["selAfter"] == [0, 1]


def test_jsonl_and_csv_roundtrip_through_real_upload_parser():
    o = run({"rows": ROWS, "selected": [0, 1, 2, 3], "shown": None}, extra=(
        "o.j=ip.parseImport('s.jsonl',o.text,{parseCSV,normalize});"
        "o.c=ip.parseImport('s.csv',toCSV(o.rows.map(r=>Object.fromEntries(Object.entries(r)))),{parseCSV,normalize});"
        "o.full=toJSONL(a.rows)===o.text;"))
    assert o["j"]["ok"] and o["j"]["rows"] == ROWS
    assert o["full"]  # all selected == whole-dataset export bytes
    assert o["c"]["ok"] and [r["id"] for r in o["c"]["rows"]][1:] == ["7", "ctx", "nulls"]  # CSV has no types, as today


def test_module_pure_no_dom_network_storage():
    src = "\n".join(l for l in MOD.read_text().splitlines() if not l.lstrip().startswith("//"))
    for bad in ("document", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "S.", "normalize("):
        assert bad not in src


def test_ui_wired_and_run_scope_untouched():
    app = APP.read_text()
    html = (ST / "index.html").read_text()
    assert 'id="exSelJ"' in html and 'id="exSelC"' in html and "selected_export.js" in html
    assert html.index("selected_export.js") < html.index("/static/app.js")
    # whole-dataset export unchanged; run still posts every row, never the selection
    assert '$("#exDataJ").onclick = () => download(`dataset-${stamp()}.jsonl`, toJSONL(S.rows));' in app
    # t_7936c995 supersedes "runBtn never reads selection" with its real invariant: the run never reads the selection
    # directly; it goes through the single run_subset projection, and the default mode is All cases.
    run_fn = app[app.index('$("#runBtn").onclick'):]
    run_fn = run_fn[:run_fn.index("\n};\n")]
    assert "S.selected" not in run_fn and "S.findShown" not in run_fn
    assert "S.runRows = structuredClone(rr.rows)" in run_fn
    assert 'id="rsAll" value="all" checked' in html and 'id="rsSel" value="selected"' in html and " checked" not in html.split('id="rsSel"')[1].split(">")[0]
