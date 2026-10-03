"""t_cfc8f5a5: failed cases of a completed run -> prepareRerun for an explicit retry.
No retained REAL failed-result evidence exists (searched workspace/deliverables + tests/fixtures), so every failure
here is a clearly labelled DETERMINISTIC FAULT SIMULATION built in the exact shapes app/main.py and foundry_run.py
emit ("Jev error 500", "No evaluate() output for this row", llm {score: None, error: "TimeoutError"}). Not live
vendor failures. The retained REAL run (t_80f908ea run2) is used as the no-failure control."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const F=require(process.argv[1]),P=require(process.argv[2]);let d='';"
        "process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const b0=JSON.stringify(a);"
        "const f=F.failedCases({results:a.results,runCfg:a.cfg});"
        "const L=f.ok?f.members.map(m=>({pos:m.pos,id:m.id})):[];"
        "const o=P.prepareRerun({members:L,runRows:a.runRows,runPos:a.rp,rows:a.rows,selected:new Set(a.sel||[])});"
        "process.stdout.write(JSON.stringify({f,o,unchanged:JSON.stringify(a)===b0}))})")
IR, GR = "intent_resolution", "groundedness"


def run(**a):
    out = subprocess.run(["node", "-e", CODE, str(ST / "failed_cases.js"), str(ST / "slow_prepare.js")],
                         input=json.dumps(a), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def ok(i, ir=4.5, gr=None, na_gr=False, llm=None):
    x = {"id": i, "jev": {IR: ir, GR: gr}, "jev_detail": {IR: {"result": "pass"}, GR: {"result": "not_applicable" if na_gr else "fail"}},
         "jev_meta": {"latency_ms": 280, "calls": 1}}
    if llm is not None: x["llm"] = llm
    return x


# SIMULATION: typed 7 fails (Jev 500), "7" is fine with a LOW score, a no-evaluate row, an LLM timeout row
ROWS = [{"id": 7, "query": "a"}, {"id": "7", "query": "b"}, {"id": "s1", "query": "c"}, {"id": "s2", "query": "d"}, {"id": "s3", "query": "e"}]
CFG = {"metrics": [IR, GR], "baseline_requested": True}
L_OK = {IR: {"score": 4}, GR: {"score": 3}}
RES = [{"id": 7, "error": "Jev error 500", "llm": L_OK},
       ok("7", ir=1.2, gr=1.0, llm=L_OK),                                   # low score = result, not failure
       {"id": "s1", "error": "No evaluate() output for this row"},          # llm not recorded -> exclusion
       ok("s2", gr=None, na_gr=True, llm={IR: {"score": None, "error": "TimeoutError"}, GR: {"score": None}}),
       ok("s3", gr=0, llm=L_OK)]                                            # 0 is a score (preserve missing vs zero)


def test_classification_separates_jev_llm_and_exclusions():
    r = run(results=RES, cfg=CFG, runRows=ROWS, rp=[0, 1, 2, 3, 4], rows=ROWS, sel=[4])
    f = r["f"]
    assert r["unchanged"] and f["ok"]
    assert [(m["pos"], m["id"]) for m in f["members"]] == [(0, 7), (2, "s1"), (3, "s2")]
    assert f["jev_rows"] == 2 and f["llm_rows"] == 1 and f["ok_rows"] == 2
    assert f["jev_reasons"] == {"Jev error 500": 1, "No evaluate() output for this row": 1}
    assert f["llm_reasons"] == {"LLM judge error: TimeoutError": 1}
    assert f["excluded"]["Jev not applicable (required inputs missing)"] == 1
    assert f["excluded"]["LLM judge not recorded"] == 2                    # s1 x 2 metrics
    assert f["excluded"]["LLM judge no score (no error recorded)"] == 1
    assert '"7"' not in [json.dumps(m["id"]) for m in f["members"]]         # low score never a failure
    o = r["o"]
    assert o["ok"] and o["after"]["positions"] == [0, 2, 3] and o["after"]["ids"] == [7, "s1", "s2"]
    assert o["removed"] == 1 and o["added"] == 3


def test_llm_not_requested_means_no_llm_failures():
    r = run(results=RES, cfg={"metrics": [IR, GR], "baseline_requested": False}, runRows=ROWS, rp=None, rows=ROWS)
    assert r["f"]["llm_rows"] == 0 and [m["id"] for m in r["f"]["members"]] == [7, "s1"]


def test_typed7_vs_string7_duplicate_stale_empty_no_dataset():
    # dataset where number 7 was replaced by text "7" copy -> refuse, never rebind
    rows = [{"id": "7", "query": "a"}] + ROWS[1:]
    r = run(results=RES, cfg=CFG, runRows=ROWS, rp=None, rows=rows, sel=[1])
    assert not r["o"]["ok"] and any(p["id"] == 7 for p in r["o"]["problems"]) and r["o"]["before"]["positions"] == [1]
    # duplicate identical copy of a failed row, no run positions -> ambiguous
    r = run(results=RES, cfg=CFG, runRows=ROWS, rp=None, rows=ROWS + [dict(ROWS[2])])
    assert not r["o"]["ok"] and any("ambiguous" in p["why"] for p in r["o"]["problems"])
    # relabel after run -> stale
    ed = json.loads(json.dumps(ROWS)); ed[3]["human_intent_resolution"] = 2
    r = run(results=RES, cfg=CFG, runRows=ROWS, rp=[0, 1, 2, 3, 4], rows=ed)
    assert not r["o"]["ok"] and "changed since the run" in r["o"]["problems"][0]["why"]
    assert run(results=RES, cfg=CFG, runRows=ROWS, rp=None, rows=[])["o"]["reason"] == "no_dataset"
    assert run(results=[], cfg=CFG, runRows=[], rp=None, rows=ROWS)["f"]["reason"] == "no_run"


def test_real_retained_run_has_no_failures():
    r2 = json.loads((ROOT / "tests/fixtures/real-2run-t80f/390-run2-raw.json").read_text())
    cfg = r2.get("runCfg") or {"metrics": sorted({k for x in r2["results"] for k in (x.get("jev") or {})})}
    r = run(results=r2["results"], cfg=cfg, runRows=r2["runRows"], rp=None, rows=r2["runRows"])
    assert r["f"]["ok"] and r["f"]["members"] == [] and r["o"]["reason"] == "empty"


def test_wiring_one_mechanism_never_runs():
    s = (ST / "app.js").read_text(); h = (ST / "index.html").read_text()
    a = s.index("// ---------- failed cases of this run"); b = s.index("// ---------- slow cases behind the p95")
    blk = s[a:b]
    blk = blk[:blk.index("function failExportHTML")] + blk[blk.index("function failPrepHtml"):]   # t_0e89d114 download is pinned separately
    assert "prepareRerun(" in blk and "failedCases(" in blk and "prepSig()" in blk and 'kind: "failed"' in blk
    for bad in ("fetch(", "api(", "runBtn", "S.rows =", "S.results =", "localStorage", "download(", "runEval"):
        assert bad not in blk, bad
    assert "repeats <b>every</b> ticked metric" in blk and "not a fix of the old run" in blk and "Foundry run path" in blk
    assert 'id="failBar"' in h and h.index("slow_prepare.js") < h.index("failed_cases.js") < h.index("/static/app.js")


def test_jev_metric_reason_and_foundry_path_honesty():
    # SIMULATION: partial Foundry-path row (jev_meta present, one metric null with a reason); Foundry LLM has no error field
    res = [{"id": "p", "jev": {IR: None}, "jev_detail": {IR: {"result": None, "reason": "evaluator timeout"}}, "llm": {IR: {"score": None}}}]
    r = run(results=res, cfg={"metrics": [IR], "baseline_requested": True, "foundry_logging_requested": True},
            runRows=[{"id": "p"}], rp=[0], rows=[{"id": "p"}])
    f = r["f"]
    assert f["jev_reasons"] == {"Jev returned no score: evaluator timeout": 1}
    assert f["llm_rows"] == 0 and f["llm_errors_unrecorded"] is True
    assert f["excluded"] == {"LLM judge no score (Foundry run path records no error field)": 1}


# t_0e89d114: download ONLY the failed cases = case_list_export over the SAME failedCases members + evaluated serializer.
EXP = ("const F=require(process.argv[1]),C=require(process.argv[2]),E=require(process.argv[3]);let d='';"
       "process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const b0=JSON.stringify(a);"
       "const f=F.failedCases({results:a.results,runCfg:a.cfg});const L=a.L||(f.ok?f.members.map(m=>({pos:m.pos,id:m.id})):[]);"
       "const x=C.buildCaseListExport({runRows:a.runRows,results:a.results,summary:a.summary,key:a.key,list:L,build:E.buildEvaluatedDataset});"
       "process.stdout.write(JSON.stringify({x,unchanged:JSON.stringify(a)===b0}))})")


def export(**a):
    out = subprocess.run(["node", "-e", EXP, str(ST / "failed_cases.js"), str(ST / "case_list_export.js"), str(ST / "evaluated_dataset.js")],
                         input=json.dumps(a), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_failed_export_exact_frozen_rows_typed_ids_no_scores():
    frozen = [dict(r, trace=[{"role": "user", "content": r["query"]}], human_intent_resolution=3, source="upload") for r in ROWS]
    r = export(results=RES, cfg=CFG, runRows=frozen, summary={"version": "v", "at": "t"}, key=None)
    assert r["unchanged"] and r["x"]["ok"]
    want = "".join(json.dumps(frozen[i], separators=(",", ":"), ensure_ascii=False) + "\n" for i in (0, 2, 3))
    assert r["x"]["text"] == want and r["x"]["ids"] == [7, "s1", "s2"] and r["x"]["n"] == 3 and r["x"]["total"] == 5
    t = r["x"]["text"]
    assert '"id":"7"' not in t and "Jev error" not in t and "TimeoutError" not in t and '"jev"' not in t and '"llm"' not in t


def test_failed_export_refuses_stale_ambiguous_key_and_partial():
    s = {"version": "v", "at": "t"}
    assert export(results=RES, cfg=CFG, runRows=ROWS, summary=s, L=[{"pos": 0, "id": "7"}])["x"]["reason"] == "stale"   # typed 7 != "7"
    assert export(results=RES, cfg=CFG, runRows=ROWS, summary=s, L=[{"pos": 0, "id": 7}, {"pos": 0, "id": 7}])["x"]["reason"] == "stale"
    assert export(results=RES, cfg=CFG, runRows=ROWS, summary=None)["x"]["reason"] == "partial"
    assert export(results=RES, cfg=CFG, runRows=[dict(ROWS[0], query="sk-SECRETKEY123")] + ROWS[1:], summary=s, key="sk-SECRETKEY123")["x"]["reason"] == "key_in_rows"
    clean = [ok(r["id"], gr=3) for r in ROWS]                                    # zero failures -> nothing to export
    assert export(results=clean, cfg=CFG | {"baseline_requested": False}, runRows=ROWS, summary=s)["x"]["reason"] == "empty"


def test_failed_export_app_wiring():
    a = (ROOT / "app/static/app.js").read_text()
    blk = a[a.index("function failExportHTML"):a.index("function failPrepHtml")]
    for k in ("failMembers(F)", "buildCaseListExport(", "sh.ref === S.results", "may contain private content", "no keys", "repeats no calls"):
        assert k in blk, k
    assert "api(" not in blk and "fetch(" not in blk and "S.results =" not in blk and "S.rows =" not in blk
