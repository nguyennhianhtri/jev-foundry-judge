"""Label queue (labelQueue / nextInQueue in app/static/label_coverage.js): exactly the buildCoverage missing+invalid
identities for one metric, dataset order, no hidden cap, n/a rows excluded, no mutation, honest end (null)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

JS = Path(__file__).resolve().parents[1] / "app" / "static" / "label_coverage.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
TOOL = [{"role": "assistant", "content": [{"type": "tool_call", "tool_call_id": "c", "name": "f", "arguments": {}}]},
        {"role": "tool", "tool_call_id": "c", "content": [{"type": "tool_result", "tool_result": {"a": 1}}]}]


def js(expr, rows):
    code = ("const L=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
            f"const rows=JSON.parse(d);const before=JSON.stringify(rows);const out={expr};"
            "if(JSON.stringify(rows)!==before)throw new Error('mutated');process.stdout.write(JSON.stringify(out))})")
    return json.loads(subprocess.run(["node", "-e", code, str(JS)], input=json.dumps(rows), capture_output=True,
                                     text=True, check=True).stdout)


def dataset():
    rows = []
    for i in range(14):   # 14 tool rows: most unlabelled for TC (>8)
        rows.append({"id": f"t{i:02d}", "query": "q", "response": TOOL, "x_unknown": {"k": i}})
    rows[1]["human_tool_call_accuracy"] = 4
    rows[3]["human_tool_call_accuracy"] = 0          # invalid
    rows[5]["human_tool_call_accuracy"] = "3"        # invalid
    for i in range(4):
        rows.append({"id": f"plain{i}", "query": "q", "response": "a", "human_tool_call_accuracy": 2 if i == 0 else None})
    return rows


def test_queue_equals_coverage_every_identity_no_cap():
    rows = dataset()
    q = js("L.labelQueue(rows,'tool_call_accuracy')", rows)
    cov = js("L.buildCoverage(rows).metrics.tool_call_accuracy", rows)
    assert len(q) == len(cov["missing"]) + len(cov["invalid"]) == 13 > 8
    assert [e["idx"] for e in q] == sorted(e["idx"] for e in q)
    assert {e["id"] for e in q if e["kind"] == "invalid"} == {"t03", "t05"}
    assert not any(e["id"].startswith("plain") for e in q)     # n/a rows excluded (even with a label)
    assert "t01" not in {e["id"] for e in q}


def test_next_walks_all_then_wraps_and_ends_null():
    rows = dataset()
    seen, frm = [], -1
    for _ in range(13):
        e = js(f"L.nextInQueue(rows,'tool_call_accuracy',{frm})", rows); seen.append(e["id"]); frm = e["idx"]
    assert len(set(seen)) == 13
    assert js(f"L.nextInQueue(rows,'tool_call_accuracy',{frm})", rows)["id"] == seen[0]   # wraps
    done = [dict(r, human_tool_call_accuracy=3) if r["id"].startswith("t") else r for r in rows]
    assert js("L.nextInQueue(rows,'tool_call_accuracy',-1)", done) is None


def test_recalculates_on_current_draft():
    rows = dataset()
    rows[0]["human_tool_call_accuracy"] = 5
    e = js("L.nextInQueue(rows,'tool_call_accuracy',-1)", rows)
    assert e["id"] == "t02"
    del rows[2]
    assert js("L.nextInQueue(rows,'tool_call_accuracy',-1)", rows)["id"] == "t03"
    assert js("L.labelQueue(rows,'nope')", rows) == []
