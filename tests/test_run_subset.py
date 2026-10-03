"""t_7936c995: opt-in run scope All cases (default) / Selected cases (app/static/run_subset.js)."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
APP = ST / "app.js"
node = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const {runRowsFor}=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
        "const a=JSON.parse(d);const before=JSON.stringify(a.rows);const r=runRowsFor({rows:a.rows,selected:new Set(a.sel),shown:a.shown,mode:a.mode});"
        "r.unchanged=JSON.stringify(a.rows)===before;r.same_objs=r.rows.every((x,k)=>x===a.rows[r.positions[k]]);process.stdout.write(JSON.stringify(r))})")
ROWS = [{"id": "a", "query": "q", "response": "x"}, {"id": 7, "query": "q", "response": "x", "extra": {"k": [1, None]}},
        {"id": "7", "query": "q", "response": "x"}, {"id": "ctx", "query": "q", "response": "x", "context": "c"}]


def run(mode, sel=(), shown=None, rows=ROWS):
    out = subprocess.run(["node", "-e", CODE, str(ST / "run_subset.js")], input=json.dumps(
        {"rows": rows, "sel": list(sel), "shown": shown, "mode": mode}), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


@node
@pytest.mark.parametrize("mode", ["all", None, "", "SELECTED", "bogus"])
def test_default_and_unknown_mode_is_all_rows_even_with_selection(mode):
    r = run(mode, sel=[1])
    assert r["ok"] and r["mode"] == "all" and r["n"] == 4 and r["rows"] == ROWS and r["positions"] == [0, 1, 2, 3]
    assert r["selected_n"] == 1 and r["unchanged"]


@node
def test_selected_exact_rows_in_dataset_order_typed_ids():
    r = run("selected", sel=[3, 1])   # insertion order must not matter
    assert r["ok"] and r["positions"] == [1, 3] and r["ids"] == [7, "ctx"] and r["rows"] == [ROWS[1], ROWS[3]]
    assert r["n"] == 2 and r["total"] == 4 and r["same_objs"] and r["unchanged"]


@node
def test_selected_counts_hidden_by_search():
    r = run("selected", sel=[0, 1], shown=[1, 2])
    assert r["ok"] and r["search"] and r["shown"] == 2 and r["hidden_selected"] == 1 and r["ids"] == ["a", 7]


@node
@pytest.mark.parametrize("sel", [[], [9], [-1]])
def test_selected_with_nothing_refuses_never_falls_back(sel):
    r = run("selected", sel=sel)
    assert not r["ok"] and r["reason"] == "none_selected" and r["rows"] == [] and r["n"] == 0 and r["total"] == 4


@node
def test_no_rows():
    assert run("all", rows=[])["reason"] == "no_rows" and run("selected", sel=[0], rows=[])["reason"] == "no_rows"


def test_module_pure():
    src = "\n".join(l for l in (ST / "run_subset.js").read_text().splitlines() if not l.lstrip().startswith("//"))
    for bad in ("document", "fetch(", "XMLHttpRequest", "localStorage", "S."):
        assert bad not in src


def test_ui_single_projection_frozen_at_start():
    app, html = APP.read_text(), (ST / "index.html").read_text()
    assert html.index("selected_export.js") < html.index("run_subset.js") < html.index("/static/app.js")
    run_fn = app[app.index('$("#runBtn").onclick'):]
    run_fn = run_fn[:run_fn.index("\n};\n")]
    # frozen once from the projection; batches, foundry and progress all read the frozen copy
    assert run_fn.count("structuredClone(") == 1 and "S.runRows = structuredClone(rr.rows)" in run_fn
    assert "body: { rows: S.runRows" in run_fn and "S.runRows.slice(i, i + B)" in run_fn
    assert "S.rows" not in run_fn.split("S.runRows = structuredClone")[1].split("S.summary = await")[0]
    assert "!sc0.run.ok" in run_fn            # refusal before any snapshot / network
    assert "cases: rr.mode" in run_fn and "dataset_rows_at_start: rr.total" in run_fn
    assert "No cases selected.</b>" in app and "does not fall back" in app


def test_critic_fixes_wired():
    app = APP.read_text()
    assert 'S.runCfg?.cases === "selected" ? runRowsFor({ rows: S.rows, selected: S.selected, mode: "selected" }).rows : S.rows' in app
    rr = app[app.index("function renderRun() {"):]; rr = rr[:rr.index("\n}\n")]
    assert "S.rows.length} rows" not in rr and "${rw}" in rr
    assert '$("#rscope").addEventListener("change", renderRun);' in app
