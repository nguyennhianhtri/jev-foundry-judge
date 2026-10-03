"""t_8407aab1: read-only incoming-case inspector inside the import preview. inspectPending reads the SAME parsed
rows Apply pushes (no re-parse, no mutation); absent/null/empty kept distinct; long text flagged; UI escapes.
SYNTHETIC fixtures only."""
import json, shutil, subprocess
from pathlib import Path
import pytest
from test_import_preview import run, _fns, ST, APP, SYN

pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def insp(name, text, pos):
    code = _fns() + f"""
const ip=require({json.dumps(str(ST / 'import_preview.js'))});
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{{const a=JSON.parse(d);
const p=ip.parseImport(a.name,a.text,{{parseCSV,normalize}});const snap=JSON.stringify(p.rows);
const x=ip.inspectPending(p.rows,a.pos);
process.stdout.write(JSON.stringify({{x,rows:p.rows,same:JSON.stringify(p.rows)===snap}}))}})"""
    out = subprocess.run(["node", "-e", code], input=json.dumps({"name": name, "text": text, "pos": pos}),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


JL = "\n".join(json.dumps(x) for x in SYN) + "\n"


def test_each_position_reads_the_row_apply_adds_and_does_not_mutate():
    for i in range(3):
        r = insp("s.jsonl", JL, i)
        assert r["same"] and r["x"]["pos"] == i and r["x"]["total"] == 3 and r["x"]["id"] == r["rows"][i]["id"]
    assert insp("s.jsonl", JL, 99)["x"]["pos"] == 2 and insp("s.jsonl", JL, -4)["x"]["pos"] == 0


def test_typed_id_and_states_distinct():
    a = insp("s.jsonl", JL, 1)["x"]
    assert a["id"] == 7 and a["id_type"] == "number"
    rich = {d["key"]: d for d in a["rich"]}
    assert rich["context"]["state"] == "null" and rich["tool_calls"]["state"] == "absent"
    assert rich["tool_definitions"]["state"] == "json_array" and rich["tool_definitions"]["items"] == 1
    assert a["answer"]["state"] == "json_array" and '"tool_call_id": "c1"' in a["answer"]["text"]
    c = insp("s.jsonl", JL, 2)["x"]
    assert c["provenance"]["source"] == "user-authored" and {d["key"]: d for d in c["rich"]}["context"]["text"] == "policy text"
    assert "human_groundedness" in c["other_fields"]
    e = insp("e.jsonl", json.dumps({"id": "e", "query": "", "response": "x", "tool_calls": []}), 0)["x"]
    assert e["request"]["state"] == "empty" and {d["key"]: d for d in e["rich"]}["tool_calls"]["state"] == "empty"


def test_long_text_verbatim_and_flagged():
    big = "line <b>x</b>\n" * 200
    x = insp("b.jsonl", json.dumps({"id": "b", "query": big, "response": "ok"}), 0)["x"]
    assert x["request"]["long"] and x["request"]["text"] == big and x["request"]["chars"] == len(big)
    assert not x["answer"].get("long")


def test_ui_is_inert_and_read_only():
    src = APP.read_text()
    body = src[src.index("function impVal"):src.index("$(\"#imprev\").onclick")]
    assert "inspectPending(im.p.rows" in body          # same pending rows, no re-parse
    assert "parseImport" not in body and "normalize(" not in body and "api(" not in body and "fetch" not in body
    assert "S.rows" not in body                          # never touches the dataset
    assert "esc(x.id)" in body and "esc(d.text)" in body
    assert src.count("S.rows.push(...rows)") == 1
