"""t_f136e25a: upload -> preview -> explicit Apply/Cancel. parseImport uses the app's REAL parseCSV + normalize
(extracted from app.js), so applied rows equal what the old one-click upload produced; malformed files are refused
with a line number and nothing is returned to apply. Fixtures here are SYNTHETIC test data."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from jev_foundry_judge.evaluators import SPECS, build_state  # noqa: E402

ST = ROOT / "app" / "static"
APP = ST / "app.js"
M4 = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def _fns():
    src = APP.read_text()
    take = lambda a, b: src[src.index(a):src.index(b, src.index(a))]
    return "\n".join(['const M = { intent_resolution: 1, task_adherence: 1, tool_call_accuracy: 1, groundedness: 1 };',
                      take("function parseCSV", "function normalize"), take("function normalize", "// Upload -> preview")])


def run(name, text, current=()):
    code = _fns() + f"""
const lc=require({json.dumps(str(ST / 'label_coverage.js'))});const ip=require({json.dumps(str(ST / 'import_preview.js'))});
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{{const a=JSON.parse(d);const before=JSON.stringify(a.cur);
const p=ip.parseImport(a.name,a.text,{{parseCSV,normalize}});
const v=p.ok?ip.previewImport(p,a.cur,{{applicable:lc.applicable,labelState:lc.labelState,METRICS:lc.METRICS}}):null;
let old=null;try{{const t=a.text;let objs;if(a.name.endsWith('.csv'))objs=parseCSV(t);else if(t.trim().startsWith('['))objs=JSON.parse(t);
else objs=t.split(/\\n/).filter(l=>l.trim()).map(l=>JSON.parse(l));old=objs.map(normalize)}}catch(e){{old='ERR'}}
process.stdout.write(JSON.stringify({{p,v,old,unchanged:JSON.stringify(a.cur)===before}}))}})"""
    out = subprocess.run(["node", "-e", code], input=json.dumps({"name": name, "text": text, "cur": list(current)}),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


SYN = [  # synthetic fixture rows
    {"id": "syn-1", "query": "Where is order 42?", "response": "It ships Friday.", "human_intent_resolution": 4, "trace_meta": {"span": "a"}},
    {"id": 7, "query": "q", "response": [{"role": "assistant", "content": [{"type": "tool_call", "tool_call_id": "c1", "name": "lookup", "arguments": {}}]}],
     "tool_definitions": [{"name": "lookup"}], "human_tool_call_accuracy": 9, "context": None},
    {"id": "syn-3", "query": "q3", "response": "a3", "context": "policy text", "source": "user-authored", "human_groundedness": None},
]


def py_app(r, m):
    return bool(SPECS[m]["requires"](build_state(r.get("query"), r.get("response"), r.get("tool_definitions"), r.get("tool_calls"), r.get("context"))))


def test_jsonl_preview_counts_and_rows_equal_old_upload():
    r = run("synthetic.jsonl", "\n".join(json.dumps(x) for x in SYN) + "\n", [{"id": "mine"}])
    assert r["p"]["ok"] and r["p"]["format"] == "JSONL" and r["unchanged"]
    assert r["p"]["rows"] == r["old"]  # same parser/normalize as before: applied rows identical
    rows = r["p"]["rows"]
    assert rows[0]["trace_meta"] == {"span": "a"} and rows[1]["id"] == 7 and rows[1]["context"] is None and rows[2]["human_groundedness"] is None
    v = r["v"]
    assert (v["incoming"], v["current"], v["after"], v["mode"]) == (3, 1, 4, "add")
    assert v["user_authored"] == 1 and v["no_id"] == 0 and v["clash_ids"] == []
    for m in M4:
        ap = [x for x in rows if py_app(x, m)]
        assert v["metrics"][m]["applicable"] == len(ap), m
    assert v["metrics"]["tool_call_accuracy"]["invalid"] == 1 and v["metrics"]["tool_call_accuracy"]["labelled"] == 0
    assert v["metrics"]["intent_resolution"]["labelled"] == 1


def test_typed_id_clash_is_exact_and_not_merged():
    r = run("s.jsonl", json.dumps({"id": 7, "query": "q", "response": "a"}) + "\n" + json.dumps({"id": "7", "query": "q", "response": "a"}), [{"id": "7"}])
    assert r["v"]["clash_ids"] == ["7"] and r["v"]["after"] == 3 and r["v"]["dup_in_file"] == 0  # 7 (number) != "7"


def test_missing_ids_reported_not_hidden():
    r = run("s.jsonl", json.dumps({"query": "q", "response": "a"}) + "\n" + json.dumps({"id": "", "query": "q"}))
    assert r["p"]["no_id_rows"] == [1, 2]


@pytest.mark.parametrize("name,text,needle", [
    ("bad.jsonl", '{"id":"a","query":"q"}\n{"id": "b", oops}\n', "line 2 is not valid JSON"),
    ("bad.jsonl", '{"id":"a"}\n[1,2]\n', "line 2 is not a JSON object"),
    ("bad.json", '[{"id":"a"}, 3]', "item 2"),
    ("bad.json", '[{"id":"a"', "not valid JSON"),
    ("empty.jsonl", "  \n", "empty"),
    ("h.csv", "id,query,response\n", "no data rows"),
])
def test_malformed_refused_with_reason_and_nothing_to_apply(name, text, needle):
    r = run(name, text, [{"id": "keep"}])
    assert not r["p"]["ok"] and needle in r["p"]["error"] and "rows" not in r["p"] and r["unchanged"]


def test_csv_roundtrip_matches_old_upload():
    csv = 'id,query,response,human_groundedness,context,extra_col\nc1,"hi, there","a ""q""",3,ctx,x\nc2,q2,a2,,,\n'
    r = run("s.csv", csv)
    assert r["p"]["ok"] and r["p"]["format"] == "CSV" and r["p"]["rows"] == r["old"]
    assert r["v"]["incoming"] == 2 and r["p"]["rows"][0]["extra_col"] == "x" and r["v"]["metrics"]["groundedness"]["applicable"] == 1


def test_apply_is_the_only_mutation_and_no_network_in_import_path():
    src = APP.read_text()
    blk = src[src.index("// Upload -> preview"):src.index('$("#genBtn")')]
    assert "api(" not in blk and "fetch(" not in blk
    assert blk.count("S.rows.push") == 1 and "impok" in blk.split("S.rows.push")[0].splitlines()[-1]
    assert "S.rows" not in (ST / "import_preview.js").read_text()
    assert "fetch" not in (ST / "import_preview.js").read_text()


def test_bom_uppercase_csv_and_non_object_array():
    assert run("s.jsonl", "\ufeff" + json.dumps({"id": "a", "query": "q"}))["p"]["ok"]
    r = run("S.CSV", "id,query\nx,y\n"); assert r["p"]["ok"] and r["p"]["format"] == "CSV"
    assert "item 1" in run("s.json", "[3]")["p"]["error"]


def test_render_escapes_file_name_and_ids():
    src = APP.read_text(); blk = src[src.index("function renderImport"):src.index('$("#imprev").onclick')]
    assert "${esc(im.name)}" in blk and "${esc(v.file)}" in blk and "esc(v.clash_ids" in blk and "esc(im.err)" in blk
