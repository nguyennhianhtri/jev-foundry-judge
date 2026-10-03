"""t_fb8d75e1: download the exact cases of an opened paired list (case_list_export.js) for a focused later run.
Bytes = the evaluated-dataset serializer's lines for exactly those frozen rows, in shown order, bound by position AND
typed id; stale/empty/partial refuse; nothing mutated. SYNTHETIC fixtures except the retained real run."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const E=require(process.argv[1]),X=require(process.argv[2]),D=require(process.argv[3]);let d='';"
        "process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const b=JSON.stringify(a);"
        "if(a.nav){const pd=D.pairedDist(a.results,a.nav.m,a.nav.c,{metrics:a.nav.metrics});a.list=D.distNavList(pd,a.nav.view,a.nav.key);}"
        "const o=X.buildCaseListExport({...a,build:E.buildEvaluatedDataset});o.full=E.buildEvaluatedDataset(a).text;o.list=a.list;"
        "o.unchanged=JSON.stringify(a)===b||!!a.nav;process.stdout.write(JSON.stringify(o))})")


def run(**a):
    out = subprocess.run(["node", "-e", CODE, str(ST / "evaluated_dataset.js"), str(ST / "case_list_export.js"), str(ST / "score_dist.js")],
                         input=json.dumps(a), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


GR = "groundedness"
ROWS = [{"id": 7, "query": "q", "response": "r", "context": "c", "human_groundedness": 5, "x_unknown": {"k": None}},
        {"id": "7", "query": "q2", "response": "r2", "context": "c", "source": "user-authored", "derived_from": {"id": 7}},
        {"id": "nolab", "query": "q3", "response": "r3", "context": "c", "tool_definitions": None},
        {"id": 7, "query": "dup", "response": "r4", "context": "c", "human_groundedness": 2}]
RES = [{"id": 7, "jev": {GR: 2.5}, "human": {GR: 5}}, {"id": "7", "jev": {GR: 2}, "human": {GR: 2}},
       {"id": "nolab", "jev": {GR: 2.2}}, {"id": 7, "jev": {GR: 4}, "human": {GR: 2}}]
SUM = {"version": "vT", "at": "2026-09-28T00:00:00Z"}
line = lambda r: json.dumps(r, separators=(",", ":"), ensure_ascii=False)


def test_exports_only_listed_in_shown_order_same_bytes_as_evaluated_dataset():
    L = [{"pos": 3, "id": 7}, {"pos": 1, "id": "7"}]
    o = run(runRows=ROWS, results=RES, summary=SUM, list=L)
    assert o["ok"] and o["n"] == 2 and o["total"] == 4 and o["ids"] == [7, "7"] and o["positions"] == [3, 1]
    assert o["text"] == line(ROWS[3]) + "\n" + line(ROWS[1]) + "\n"
    full = o["full"].splitlines()
    assert o["text"].splitlines() == [full[3], full[1]]
    assert [json.loads(x) for x in o["text"].splitlines()] == [ROWS[3], ROWS[1]]  # unknown fields/nulls/provenance kept
    assert "jev" not in o["text"] and o["version"] == "vT" and o["unchanged"]


def test_typed_id_and_position_must_both_bind_else_refuse_whole_file():
    for bad in ([{"pos": 1, "id": 7}], [{"pos": 0, "id": "7"}], [{"pos": 9, "id": 7}], [{"pos": 0, "id": 7}, {"pos": 0, "id": 7}],
                [{"pos": 0.5, "id": 7}]):
        o = run(runRows=ROWS, results=RES, summary=SUM, list=bad)
        assert o == {**o, "ok": False, "reason": "stale"} and "text" not in o


def test_empty_partial_norun_and_key_refuse():
    assert run(runRows=ROWS, results=RES, summary=SUM, list=[])["reason"] == "empty"
    assert run(runRows=ROWS, results=RES[:2], summary=SUM, list=[{"pos": 0, "id": 7}])["reason"] == "partial"
    assert run(runRows=[], results=[], summary=None, list=[{"pos": 0, "id": 7}])["reason"] == "no_run"
    assert run(runRows=ROWS, results=RES, summary=None, list=[{"pos": 0, "id": 7}])["reason"] == "partial"
    k = dict(ROWS[2], note="sk-secretkey123")
    assert run(runRows=[ROWS[0], ROWS[1], k, ROWS[3]], results=RES, summary=SUM, key="sk-secretkey123",
               list=[{"pos": 0, "id": 7}])["reason"] == "key_in_rows"


def test_paired_bin_list_from_projection_exported_exactly():
    o = run(runRows=ROWS, results=RES, summary=SUM, nav={"m": GR, "c": "human", "metrics": [GR], "view": "bins", "key": "2-3"})
    assert [[m["pos"], m["id"]] for m in o["list"]] == [[0, 7], [1, "7"], [3, 7]]  # nolab has no human label: never exported
    assert [json.loads(x) for x in o["text"].splitlines()] == [ROWS[0], ROWS[1], ROWS[3]]


def test_real_retained_run_every_paired_list_roundtrips_to_frozen_rows():
    st = json.loads((ROOT / "tests/fixtures/real-run-t389-key1440-frozen-state.json").read_text())
    ms, seen = st["runCfg"]["metrics"], 0
    for m in ms:
        for c in ("llm", "human"):
            for k in ("1-2", "2-3", "3-4", "4-5"):
                o = run(runRows=st["runRows"], results=st["results"], summary=st["summary"],
                        nav={"m": m, "c": c, "metrics": ms, "view": "bins", "key": k})
                if not o["list"]:
                    assert o["reason"] == "empty"; continue
                seen += 1
                assert o["ok"] and [json.loads(x) for x in o["text"].splitlines()] == [st["runRows"][e["pos"]] for e in o["list"]]
    assert seen >= 4
