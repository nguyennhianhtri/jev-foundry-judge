"""t_c4611cce: 'What these metrics check' guide is a pure projection of the canonical evaluator definitions."""
import json, shutil, subprocess
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app.main import app
from jev_foundry_judge.evaluators import LEVELS_5, METRICS, SPECS, build_state

ST = Path(__file__).resolve().parents[1] / "app" / "static"
node = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const L=require(process.argv[1]);const G=require(process.argv[2]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
        "const a=JSON.parse(d);const b=JSON.stringify(a);const g=G.guide(a.sel,a.cfg,a.rows,L.applicable);"
        "process.stdout.write(JSON.stringify({g,unchanged:JSON.stringify(a)===b}))})")
ROWS = [{"id": "a", "query": "q", "response": "x"}, {"id": "b", "query": "q", "response": "x", "context": "c"},
        {"id": "t", "query": "q", "response": "x", "tool_definitions": [{"name": "f"}]},
        {"id": "tc", "query": "q", "response": "x", "tool_calls": [{"type": "tool_call", "name": "f", "arguments": {}}]},
        {"id": "tr", "query": [{"role": "user", "content": "q"}], "response": [
            {"role": "assistant", "content": [{"type": "tool_call", "name": "f", "arguments": {}}]},
            {"role": "tool", "content": "r"}, {"role": "assistant", "content": "a"}]}]


def cfg():
    return TestClient(app).get("/api/config").json()


def guide(sel, rows=ROWS):
    out = subprocess.run(["node", "-e", CODE, str(ST / "label_coverage.js"), str(ST / "metric_guide.js")],
                         input=json.dumps({"sel": sel, "cfg": cfg(), "rows": rows}), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_config_levels_are_canonical():
    c = cfg()
    assert c["metrics"] == METRICS and c["levels"] == {m: LEVELS_5[m] for m in METRICS}


@node
def test_selected_only_canonical_order_and_checks_match_specs():
    r = guide(["groundedness", "intent_resolution"])
    assert r["unchanged"]
    assert [x["metric"] for x in r["g"]] == ["intent_resolution", "groundedness"]
    for x in r["g"]:
        atoms = SPECS[x["metric"]]["atoms"]
        assert [c["question"] for c in x["checks"]] == [a.question["instructions"] for a in atoms]
        assert x["critical"] == [a.label for a in atoms if a.critical]
        assert x["low"] == LEVELS_5[x["metric"]][0] and x["high"] == LEVELS_5[x["metric"]][-1]
    assert guide([])["g"] == []


@node
def test_na_counts_match_python_requires():
    r = guide(METRICS)
    for x in r["g"]:
        py = sum(1 for row in ROWS if not SPECS[x["metric"]]["requires"](build_state(row.get("query"), row.get("response"), row.get("tool_definitions"), row.get("tool_calls"), row.get("context"))))
        assert x["na_now"] == py
        assert x["always"] == (x["metric"] in ("intent_resolution", "task_adherence"))
