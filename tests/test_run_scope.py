"""t_9505c634: pre-run scope summary (app/static/run_scope.js) + server refusal of zero metrics."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
node = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const {buildCoverage,applicable}=require(process.argv[1]);const {runScope}=require(process.argv[2]);"
        "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const before=JSON.stringify(a.rows);"
        "const r=runScope(a.rows,a.sel,{baseline:a.bl,all:a.all,applicable});r.unchanged=JSON.stringify(a.rows)===before;"
        "process.stdout.write(JSON.stringify(r))})")
ALL = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]
ROWS = [
    {"id": "a", "query": "q", "response": "plain"},                                        # IR, TA only
    {"id": "b", "query": "q", "response": "x", "context": "ctx"},                           # + GR
    {"id": "c", "query": "q", "response": "x", "tool_definitions": [{"name": "t"}]},       # + TC
    {"id": "d", "query": "q", "response": [{"role": "assistant", "content": [{"type": "tool_call", "name": "t", "arguments": {}}]},
                                           {"role": "tool", "content": "res"}]},            # + TC + GR
]


def scope(sel, rows=ROWS, bl=False):
    out = subprocess.run(["node", "-e", CODE, str(ST / "label_coverage.js"), str(ST / "run_scope.js")],
                         input=json.dumps({"rows": rows, "sel": sel, "bl": bl, "all": ALL}),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


@node
def test_all_metrics_counts_with_na_distinct():
    r = scope(ALL)
    assert r["ok"] and r["rows"] == 4 and r["all_selected"] and r["unchanged"]
    by = {x["metric"]: x for x in r["metrics"]}
    assert [x["metric"] for x in r["metrics"]] == ALL
    assert (by["intent_resolution"]["applicable"], by["intent_resolution"]["not_applicable"]) == (4, 0)
    assert (by["tool_call_accuracy"]["applicable"], by["tool_call_accuracy"]["not_applicable"]) == (2, 2)
    assert (by["groundedness"]["applicable"], by["groundedness"]["not_applicable"]) == (2, 2)
    assert r["jev_calls"] == 4


@node
def test_subset_keeps_order_and_skips_rows_with_nothing_applicable():
    r = scope(["groundedness", "tool_call_accuracy"])     # given out of order; canonical order kept
    assert r["ok"] and not r["all_selected"]
    assert [x["metric"] for x in r["metrics"]] == ["tool_call_accuracy", "groundedness"]
    assert r["jev_calls"] == 3                            # row a: no selected metric applies -> judge makes no call
    assert r["rows_no_call"] == 1


@node
def test_zero_metrics_refused_and_unknown_ignored():
    r = scope([])
    assert r["ok"] is False and r["reason"] == "no_metrics" and r["jev_calls"] == 0
    assert scope(["bogus"])["reason"] == "no_metrics"


@node
def test_no_rows_and_baseline_flag():
    r = scope(ALL, rows=[])
    assert r["ok"] is False and r["reason"] == "no_rows"
    assert scope(ALL, bl=True)["baseline"] is True and scope(ALL)["baseline"] is False


def test_server_refuses_zero_metrics_without_any_call(monkeypatch):
    from fastapi.testclient import TestClient
    import app.main as m
    calls = []
    monkeypatch.setattr(m.JevClient, "ask", lambda *a, **k: calls.append(1) or (_ for _ in ()).throw(AssertionError("called")))
    c = TestClient(m.app)
    for path in ("/api/judge", "/api/foundry-run"):
        for metrics in ([], ["bogus"]):
            r = c.post(path, headers={"x-jev-key": "k"}, json={"rows": [{"id": "a", "query": "q", "response": "r"}], "metrics": metrics})
            if path == "/api/foundry-run" and not m.foundry_run.project_endpoint():
                assert r.status_code == 400
                continue
            assert r.status_code == 400 and "metric" in r.json()["detail"].lower(), (path, metrics, r.text)
    assert calls == []


def test_app_wires_scope_and_honest_label():
    js = (ST / "app.js").read_text()
    html = (ST / "index.html").read_text()
    assert 'id="runScope"' in html and "/static/run_scope.js" in html
    assert html.index("/static/run_scope.js") < html.index("/static/app.js")
    assert "all metrics fanned out" not in js
    assert "runScope(" in js
