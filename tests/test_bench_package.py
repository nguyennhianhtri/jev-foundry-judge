"""t_389b5628: Download benchmark package = one versioned JSON bundle of the last COMPLETED run.
Each component is the exact text of its existing export; readiness mirrors the evaluated dataset (refuse before
run / running / partial / misaligned / after Clear); unknown config stays null; no key; UI reads frozen state only."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")

ROWS = [{"id": 7, "query": "q", "response": [{"role": "assistant", "content": "x"}], "human_intent_resolution": 4},
        {"id": "7", "query": "q2", "response": "r", "tool_definitions": None, "source": "user-authored"}]
RES = [{"id": 7, "jev": {"intent_resolution": 5}}, {"id": "7", "jev": {"intent_resolution": 2}, "error": None}]
SUMMARY = {"version": "v1.31.0-test", "at": "2026-09-27T13:00:00Z", "rows": 2, "threshold": 3.0, "scope": "full run"}
CFG = {"metrics": ["intent_resolution"], "baseline_requested": True}

RUN = ("const {buildBenchPackage}=require(process.argv[1]);const {buildEvaluatedDataset}=require(process.argv[2]);"
       "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);a.build=buildEvaluatedDataset;"
       "process.stdout.write(JSON.stringify(buildBenchPackage(a)))})")


def run(payload):
    out = subprocess.run(["node", "-e", RUN, str(ST / "bench_package.js"), str(ST / "evaluated_dataset.js")],
                         input=json.dumps(payload), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def base(**kw):
    p = {"runRows": ROWS, "results": RES, "summary": SUMMARY, "resultsText": "R1\nR2\n", "summaryText": "{\"s\":1}",
         "briefText": "# brief\n", "runConfig": CFG, "appVersion": "v1.31.0-live", "exportedAt": "2026-09-27T14:00:00Z"}
    p.update(kw)
    return p


def test_bundle_components_are_exact_texts_and_manifest_is_honest():
    o = run(base())
    assert o["ok"]
    pkg = json.loads(o["text"])
    f, m = pkg["files"], pkg["manifest"]
    assert f["evaluated-dataset.jsonl"] == "".join(json.dumps(r, separators=(",", ":")) + "\n" for r in ROWS)
    assert f["results.jsonl"] == "R1\nR2\n" and f["benchmark.json"] == "{\"s\":1}" and f["benchmark-brief.md"] == "# brief\n"
    assert m["format"] == "jev-foundry-judge.benchmark-package" and m["format_version"] == 1
    assert m["run"]["recorded_app_version"] == "v1.31.0-test" and m["export"]["app_version"] == "v1.31.0-live"
    assert m["run"]["completed_at"] == SUMMARY["at"] and m["export"]["exported_at"] == "2026-09-27T14:00:00Z"
    assert m["run"]["ids_in_order"] == [7, "7"] and m["run"]["rows"] == 2 and m["run"]["results"] == 2
    assert m["run"]["recorded_config"] == CFG and m["run"]["threshold"] == 3.0
    assert m["run"]["baseline_label"] is None and m["run"]["wall_s"] is None  # unknown stays null


def test_unrecorded_config_and_missing_brief_stay_unknown():
    o = run(base(runConfig=None, briefText=None))
    pkg = json.loads(o["text"])
    assert o["ok"] and pkg["manifest"]["run"]["recorded_config"] is None
    assert pkg["files"]["benchmark-brief.md"] is None and pkg["manifest"]["components"]["brief"] is None


@pytest.mark.parametrize("kw,reason", [
    ({"runRows": [], "results": [], "summary": None, "resultsText": None, "summaryText": None}, "no_run"),  # before run / Clear
    ({"results": [], "summary": None, "resultsText": None, "summaryText": None}, "running_or_none"),
    ({"results": RES[:1], "summary": None, "resultsText": None, "summaryText": None}, "partial"),
    ({"results": RES[:1]}, "partial"),
    ({"results": [RES[0], {"id": "other", "jev": {}}]}, "misaligned"),
])
def test_refuses_incomplete_states(kw, reason):
    o = run(base(**kw))
    assert o["ok"] is False and o["reason"] == reason and "text" not in o


@pytest.mark.parametrize("field", ["briefText", "resultsText", "summaryText"])
def test_key_anywhere_is_refused(field):
    o = run(base(key="jev_sk_SECRET123", **{field: "leak jev_sk_SECRET123"}))
    assert o["ok"] is False and o["reason"] == "key_in_rows"


def test_bytes_are_utf8():
    o = run(base(briefText="é—\n"))
    assert json.loads(o["text"])["manifest"]["components"]["brief"]["bytes"] == len("é—\n".encode())


def test_package_does_not_change_brief_preview_timestamp():
    src = (ST / "app.js").read_text()
    body = src[src.index("function pkgExport()"):src.index("function renderPkgExport()")]
    assert "S.briefAt =" not in body and "briefText(exportedAt)" in body


def test_ui_wiring_reads_frozen_state_reuses_serializers_and_discloses():
    src = (ST / "app.js").read_text()
    body = src[src.index("function pkgExport()"):src.index("function renderSnippet()")]
    assert "S.runRows" in body and "S.rows" not in body.replace("S.runRows", "")
    assert "toJSONL(flatResults())" in body and "JSON.stringify(S.summary, null, 2)" in body and "briefText(exportedAt)" in body
    assert "fetch(" not in body and "api(" not in body and "S.key" in body  # key only passed for refusal check
    assert "S.runCfg = null" in src[src.index('$("#clearBtn")'):]  # Clear drops recorded config
    rec = src[src.index("S.runCfg = {"):]
    rec = rec[:rec.index("};")]
    assert "key" not in rec.lower().replace("jev_usd", "") and "endpoint" not in rec.lower()
    html = (ST / "index.html").read_text()
    assert "Download benchmark package (.json)" in html and "Contains case text and tool data" in html
    assert "not an anonymised or public copy" in html and "All files save locally" in html  # t_1ab27b73: one shared local-only line
    assert html.index("bench_package.js") < html.index("/static/app.js")
    for kept in ("exDataJ", "exEvalJ", "exResJ", "exSum", "exBrief"):
        assert f'id="{kept}"' in html  # existing separate exports preserved
