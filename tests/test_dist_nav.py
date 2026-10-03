"""t_ad616649: Previous/Next through the EXACT paired-comparison case list the user opened from (score_dist.js
distNavList / distNavStep). Fixtures labelled SYNTHETIC except the retained real run."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const D=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);"
        "const before=JSON.stringify(a.results);const pd=D.pairedDist(a.results,a.m,a.c,{metrics:a.metrics});"
        "const L=D.distNavList(pd,a.view,a.key);const o={L,steps:(a.steps||[]).map(s=>D.distNavStep(L,s[0],s[1],s[2]))};"
        "o.pts=D.pairPoints(pd).points.map(g=>g.key);o.bin=a.view==='bins'?D.pairedBinCases(pd,a.key).map(p=>[p.pos,p.id]):null;"
        "o.unchanged=JSON.stringify(a.results)===before;process.stdout.write(JSON.stringify(o))})")
GR = "groundedness"


def run(results, view, key, c="human", m=GR, metrics=None, steps=None):
    out = subprocess.run(["node", "-e", CODE, str(ST / "score_dist.js")], input=json.dumps(
        {"results": results, "m": m, "c": c, "metrics": metrics or [m], "view": view, "key": key, "steps": steps}),
        capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


# SYNTHETIC: duplicate typed ids (7 vs "7") and a repeated id 7 at two positions
R = [{"id": 7, "jev": {GR: 2.5}, "human": {GR: 5}}, {"id": "7", "jev": {GR: 2}, "human": {GR: 2}},
     {"id": "nolab", "jev": {GR: 2.2}}, {"id": 7, "jev": {GR: 4}, "human": {GR: 2}},
     {"id": "x", "jev": {GR: 2.5}, "human": {GR: 5}}]


def test_bins_list_is_exact_paired_bin_membership_in_run_order():
    o = run(R, "bins", "2-3")
    assert [[i["pos"], i["id"]] for i in o["L"]] == o["bin"] == [[0, 7], [1, "7"], [3, 7], [4, "x"]]
    assert o["unchanged"]


def test_pairs_list_is_selected_point_members():
    o = run(R, "pairs", "[2.5,5]")
    assert [[i["pos"], i["id"]] for i in o["L"]] == [[0, 7], [4, "x"]]
    assert run(R, "pairs", "nope")["L"] == []


def test_step_binds_position_and_typed_id_duplicates_never_confused():
    o = run(R, "bins", "2-3", steps=[[0, 7, 1], [1, "7", 1], [3, 7, -1], [0, 7, -1], [4, "x", 1],
                                    [1, 7, 1], [2, "nolab", 1], [3, "7", 1]])
    s = o["steps"]
    assert s[0] == {"ok": True, "i": 1, "n": 4, "pos": 1, "id": "7"}
    assert s[1] == {"ok": True, "i": 2, "n": 4, "pos": 3, "id": 7}
    assert s[2] == {"ok": True, "i": 1, "n": 4, "pos": 1, "id": "7"}
    assert s[3]["ok"] is False and s[3]["edge"] == "first"
    assert s[4]["ok"] is False and s[4]["edge"] == "last"
    # wrong type / not a member / id-pos mismatch: refused, never another row
    assert all(x == {"ok": False, "edge": None} for x in s[5:])


def test_llm_comparator_real_retained_run_lists_match_projection():
    st = json.loads((ROOT / "tests/fixtures/real-run-t389-key1440-frozen-state.json").read_text())
    res, ms = st["results"], st["runCfg"]["metrics"]
    seen = 0
    for m in ms:
        for c in ("human", "llm"):
            for k in ("1-2", "2-3", "3-4", "4-5"):
                o = run(res, "bins", k, c, m, ms)
                assert [[i["pos"], i["id"]] for i in o["L"]] == o["bin"]
                seen += len(o["L"])
            o = run(res, "pairs", None, c, m, ms)
            for key in o["pts"]:
                L = run(res, "pairs", key, c, m, ms)["L"]
                assert L and all(json.dumps([res[i["pos"]]["jev"][m], (res[i["pos"]].get("human") or {}).get(m) if c == "human" else res[i["pos"]]["llm"][m]["score"]], separators=(",", ":")) == key for i in L)
    assert seen > 0
