"""t_59b45262: read-only sample scenario preview (app/static/sample_preview.js). Counts are bound to an independent
Python recount over every shipped sample, using the REAL Python judge applicability (build_state + SPECS.requires);
the preview never mutates rows; Add scenario semantics (skip ids already present) are unchanged."""
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
M4 = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const lc=require(process.argv[1]);const {samplePreview}=require(process.argv[2]);"
        "const userText=q=>typeof q==='string'?q:((q||[]).filter(m=>m.role==='user').pop()||{}).content||'';"
        "const finalText=r=>{if(typeof r==='string')return r;for(const m of [...(r||[])].reverse()){if(m.role!=='assistant')continue;"
        "if(typeof m.content==='string')return m.content;const t=(m.content||[]).filter(c=>c.type==='text').map(c=>c.text).join(' ');if(t)return t;}return ''};"
        "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const b=JSON.stringify([a.s,a.rows]);"
        "const v=samplePreview(a.s,a.rows,{applicable:lc.applicable,labelState:lc.labelState,METRICS:lc.METRICS,userText,finalText});"
        "v.unchanged=JSON.stringify([a.s,a.rows])===b;process.stdout.write(JSON.stringify(v))})")


def prev(s, rows):
    out = subprocess.run(["node", "-e", CODE, str(ST / "label_coverage.js"), str(ST / "sample_preview.js")],
                         input=json.dumps({"s": s, "rows": rows}), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def samples():
    for p in sorted((ROOT / "samples").glob("*.jsonl")):
        yield {"name": p.stem, "rows": [json.loads(l) for l in p.read_text().splitlines() if l.strip()]}


def py_applicable(r, m):
    return bool(SPECS[m]["requires"](build_state(r.get("query"), r.get("response"), r.get("tool_definitions"),
                                                  r.get("tool_calls"), r.get("context"))))


@pytest.mark.parametrize("s", list(samples()), ids=lambda s: s["name"])
def test_counts_match_independent_recount(s):
    v = prev(s, [])
    assert v["unchanged"] and v["name"] == s["name"] and v["count"] == len(s["rows"]) == v["will_add"] and v["already"] == 0
    assert v["generated"] == 0 and v["rep"]["id"] == s["rows"][0]["id"]
    for m in M4:
        ap = [r for r in s["rows"] if py_applicable(r, m)]
        lab = [r for r in ap if isinstance(r.get("human_" + m), int) and 1 <= r["human_" + m] <= 5]
        assert v["metrics"][m] == {"applicable": len(ap), "labelled": len(lab), "not_applicable": len(s["rows"]) - len(ap)}, m


def test_will_add_mirrors_add_scenario_id_skip():
    s = next(samples())
    ids = [r["id"] for r in s["rows"]]
    v = prev(s, [{"id": ids[0], "query": "edited", "response": "x"}, {"id": "mine", "query": "q", "response": "a"}])
    assert (v["will_add"], v["already"], v["unchanged"]) == (len(ids) - 1, 1, True)
    assert prev(s, s["rows"])["will_add"] == 0


def test_add_semantics_and_preview_is_read_only_in_app():
    js = (ST / "app.js").read_text()
    assert "S.rows.push(...structuredClone(s.rows).filter(r => !have.has(r.id))); renderData();" in js
    body = js[js.index("function renderSamplePreview"):js.index('$("#sample").onchange')]
    for bad in ("api(", "S.rows =", "S.rows.push", "S.results", "S.runRows", "localStorage", "fetch("):
        assert bad not in body, bad
    html = (ST / "index.html").read_text()
    assert '<label class="sampl" for="sample">' in html and 'id="sprev"' in html
    assert html.index("sample_preview.js") < html.index("/static/app.js")
