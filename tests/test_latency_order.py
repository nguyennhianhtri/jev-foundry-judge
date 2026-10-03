"""t_bef3dda6: Results-by-row view order "Slowest Jev call first" over exact recorded jev_meta.latency_ms.
Labelled synthetic fixtures for null/non-finite/ties/typed ids; the retained REAL run for distinct latencies."""
import json, shutil, subprocess
from pathlib import Path
import pytest

R = Path(__file__).resolve().parents[1]
JS = R / "app" / "static" / "latency_order.js"
REAL = R / "tests" / "fixtures" / "real-run-t389-key1440-frozen-state.json"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def node(body, **kw):
    code = "const L=require(process.argv[1]);const A=JSON.parse(process.argv[2]);process.stdout.write(JSON.stringify((()=>{" + body + "})()))"
    return json.loads(subprocess.run(["node", "-e", code, str(JS), json.dumps(kw)], capture_output=True, text=True, check=True).stdout)


def test_real_run_slowest_independently_recomputed_and_state_untouched():
    st = json.loads(REAL.read_text()); res = st["results"]
    o = node("const s=JSON.stringify(A.r);const v=L.latencyView(A.r,A.r.map((_,i)=>i),'slowest');return {v,same:JSON.stringify(A.r)===s}", r=res)
    want = sorted(range(len(res)), key=lambda i: (-res[i]["jev_meta"]["latency_ms"], i))
    assert [e["pos"] for e in o["v"]["rows"]] == want and o["same"]
    assert o["v"]["valid"] == 7 and o["v"]["unavailable"] == 0
    assert len({r["jev_meta"]["latency_ms"] for r in res}) == 7          # genuinely distinct recorded latencies
    run = node("return L.latencyView(A.r,A.r.map((_,i)=>i),'run')", r=res)
    assert [e["pos"] for e in run["rows"]] == list(range(7))


def test_fixture_null_nonfinite_ties_unavailable_last_never_zero():
    # labelled fixture: JSON can't carry NaN/Infinity, so they are built in node
    o = node("""const r=[{id:'a',jev_meta:{latency_ms:100}},{id:'err',error:'boom'},{id:'b',jev_meta:{latency_ms:300}},
      {id:'nan',jev_meta:{latency_ms:NaN}},{id:'c',jev_meta:{latency_ms:100}},{id:'inf',jev_meta:{latency_ms:Infinity}},
      {id:'str',jev_meta:{latency_ms:'500'}},{id:'nul',jev_meta:{latency_ms:null}},{id:'zero',jev_meta:{latency_ms:0}}];
      return L.latencyView(r,r.map((_,i)=>i),'slowest')""")
    assert [e["id"] for e in o["rows"]] == ["b", "a", "c", "zero", "err", "nan", "inf", "str", "nul"]
    assert o["valid"] == 4 and o["unavailable"] == 5
    assert [e["ms"] for e in o["rows"][4:]] == [None] * 5              # unavailable, not 0


def test_filtered_subset_and_typed_duplicate_ids_bind_position_and_type():
    r = [{"id": 7, "jev_meta": {"latency_ms": 5}}, {"id": "7", "jev_meta": {"latency_ms": 9}},
         {"id": "dup", "jev_meta": {"latency_ms": 1}}, {"id": "dup", "jev_meta": {"latency_ms": 8}}]
    o = node("return L.latencyView(A.r,[0,2,3],'slowest')", r=r)
    assert [(e["pos"], e["id"]) for e in o["rows"]] == [(3, "dup"), (0, 7), (2, "dup")]
    rr = [{"id": x["id"]} for x in r]
    got = node("return [L.resolveRow(A.r,A.rr,0,7),L.resolveRow(A.r,A.rr,0,'7'),L.resolveRow(A.r,A.rr,3,'dup'),L.resolveRow(A.r,A.rr,9,'dup'),L.resolveRow(A.r,[],0,7)]", r=r, rr=rr)
    assert got == [True, False, True, False, False]


def test_app_wiring_view_only():
    a = (R / "app/static/app.js").read_text(); h = (R / "app/static/index.html").read_text()
    assert 'id="fOrder"' in h and "Slowest Jev call first" in h and h.index("latency_order.js") < h.index("/static/app.js")
    for k in ("S.rtRef !== S.results", 'if (all) all.onclick = () => openRow(pos, id, null', "latencyView(S.results, idxsF, SC?.ok ? \"slowest\" : S.order)", "resolveRow(S.results, S.runRows, pos, id)", "← Back to results", "Jev call latency", "never counted as 0"):
        assert k in a, k
    blk = a[a.index("function renderRows"):a.index('$("#fView").onchange')]
    assert "S.results.sort" not in blk and "S.runRows.sort" not in blk and "S.results =" not in blk
    # exports read S.results in run order, untouched by the view
    assert "return S.results.map(x =>" in a
