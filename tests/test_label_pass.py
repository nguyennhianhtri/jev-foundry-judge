"""One-row all-metric label pass (caseLabels / casesNeedingLabels / nextCaseNeeding / planCaseLabels in
app/static/label_coverage.js): same applicability as coverage, n/a excluded with reason, invalid not editable here,
only typed changes planned, no mutation."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

JS = Path(__file__).resolve().parents[1] / "app" / "static" / "label_coverage.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
TOOL = [{"role": "assistant", "content": [{"type": "tool_call", "tool_call_id": "c", "name": "f", "arguments": {}}]},
        {"role": "tool", "tool_call_id": "c", "content": [{"type": "tool_result", "tool_result": {"a": 1}}]}]
ALL = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]


def js(expr, rows):
    code = ("const L=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
            f"const rows=JSON.parse(d);const before=JSON.stringify(rows);const out={expr};"
            "if(JSON.stringify(rows)!==before)throw new Error('mutated');process.stdout.write(JSON.stringify(out===undefined?null:out))})")
    return json.loads(subprocess.run(["node", "-e", code, str(JS)], input=json.dumps(rows), capture_output=True,
                                     text=True, check=True).stdout)


def dataset():
    rows = [{"id": f"t{i}", "query": "q", "response": TOOL, "x": {"k": i}} for i in range(10)]
    for m in ALL:
        rows[0]["human_" + m] = 4                        # complete
    rows[1]["human_tool_call_accuracy"] = 0              # invalid
    rows[2].update(human_intent_resolution=3)            # partial
    rows.append({"id": "plain", "query": "q", "response": "a", "human_intent_resolution": 2, "human_task_adherence": 2,
                 "human_tool_call_accuracy": 5})         # complete for applicable; TC/GR n/a (TC labelled, ignored)
    return rows


def test_case_labels_na_reason_and_values():
    c = js("L.caseLabels(rows[10])", dataset())
    assert c["tool_call_accuracy"]["applicable"] is False and "tool" in c["tool_call_accuracy"]["reason"]
    assert c["groundedness"]["applicable"] is False and "context" in c["groundedness"]["reason"]
    assert c["intent_resolution"] == {"applicable": True, "reason": None, "state": "ok", "value": 2}
    assert js("L.caseLabels(rows[1]).tool_call_accuracy.state", dataset()) == "invalid"


def test_cases_needing_excludes_complete_and_na():
    q = js("L.casesNeedingLabels(rows)", dataset())
    ids = [e["id"] for e in q]
    assert ids == [f"t{i}" for i in range(1, 10)] and len(q) == 9 > 8
    assert q[0]["invalid"] == ["tool_call_accuracy"]
    assert q[1]["need"] == ["task_adherence", "tool_call_accuracy", "groundedness"]
    assert js("L.nextCaseNeeding(rows,9)", dataset())["id"] == "t1"      # wraps
    done = [dict(r, **{"human_" + m: 3 for m in ALL}) for r in dataset()]
    assert js("L.nextCaseNeeding(rows,-1)", done) is None


def test_plan_only_typed_changes_invalid_and_na_untouched():
    rows = dataset()
    p = js("L.planCaseLabels(rows[2],{intent_resolution:'3',task_adherence:'5',tool_call_accuracy:'',groundedness:'2'})", rows)
    assert p == {"ok": True, "errors": {}, "changes": {"task_adherence": 5, "groundedness": 2}}
    p = js("L.planCaseLabels(rows[1],{tool_call_accuracy:'4',intent_resolution:'6'})", rows)
    assert p["ok"] is False and "intent_resolution" in p["errors"] and "tool_call_accuracy" not in p["changes"]
    p = js("L.planCaseLabels(rows[10],{tool_call_accuracy:'',intent_resolution:''})", rows)
    assert p["changes"] == {"intent_resolution": None}                   # explicit blank deletes; n/a label untouched
    assert js("L.planCaseLabels(rows[0],{})", rows)["changes"] == {}


def test_label_key_action_scoped_digits_enter_only():
    k = lambda ev: js(f"L.labelKeyAction({json.dumps(ev)})", [])
    assert [k({"key": d})["set"] for d in "12345"] == list("12345")
    for ev in ({"key": "0"}, {"key": "6"}, {"key": "Tab"}, {"key": "Tab", "shiftKey": True}, {"key": "Escape"},
               {"key": "Backspace"}, {"key": "a"}, {"key": "3", "ctrlKey": True}, {"key": "3", "metaKey": True},
               {"key": "3", "altKey": True}, {"key": "3", "isComposing": True}, {"key": "Enter", "isComposing": True},
               {"key": "Enter", "shiftKey": True}, {"key": "3", "repeat": True}):
        assert k(ev) is None, ev
    assert k({"key": "Enter"}) == "save_next" and k({"key": "Enter", "repeat": True}) == "swallow"
