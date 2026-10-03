"""t_eae08a5f: Previous/Next matching case over the exact visible search+view projection + unbound-trace disclosure."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def call(fn, *args):
    code = ("const m=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);"
            "const b=JSON.stringify(a);const r=m[a.fn](...a.args);process.stdout.write(JSON.stringify({r:r===undefined?null:r,"
            "unchanged:JSON.stringify(a)===b}))})")
    out = subprocess.run(["node", "-e", code, str(ST / "case_find.js")], input=json.dumps({"fn": fn, "args": list(args)}),
                         capture_output=True, text=True, check=True)
    o = json.loads(out.stdout)
    assert o["unchanged"]
    return o["r"]


RES = [{"id": 7}, {"id": "7"}, {"id": "sup-01"}, {"id": "sup-01"}, {"id": "q"}, {}]


def test_match_list_is_visible_order_with_typed_ids():
    L = call("runMatchList", RES, [3, 0, 1, 2, 99, -1])
    assert L == [{"pos": 3, "id": "sup-01"}, {"pos": 0, "id": 7}, {"pos": 1, "id": "7"}, {"pos": 2, "id": "sup-01"}]


def test_step_middle_and_ends_disabled():
    L = call("runMatchList", RES, [0, 1, 2, 3])
    assert call("runMatchStep", L, 1, "7", 1) == {"ok": True, "i": 2, "n": 4, "pos": 2, "id": "sup-01", "skipped": 0}
    assert call("runMatchStep", L, 0, 7, -1)["edge"] == "first" and not call("runMatchStep", L, 0, 7, -1)["ok"]
    assert call("runMatchStep", L, 3, "sup-01", 1)["edge"] == "last"
    assert call("runMatchStep", L, 0, 7, 0)["i"] == 0


def test_unopenable_entries_are_skipped_not_dead_ends():
    L = [{"pos": 0, "id": 7}, {"pos": 1, "id": "7", "open": False}, {"pos": 2, "id": "sup-01"}]
    s = call("runMatchStep", L, 0, 7, 1)
    assert s["ok"] and s["pos"] == 2 and s["skipped"] == 1 and s["i"] == 2
    assert call("runMatchStep", L, 2, "sup-01", -1)["pos"] == 0
    L2 = [{"pos": 0, "id": 7}, {"pos": 1, "id": "x", "open": False}]
    e = call("runMatchStep", L2, 0, 7, 1)
    assert not e["ok"] and e["edge"] == "last" and e["skipped"] == 1
    k1 = call("runMatchKey", [{"pos": 1, "id": "x"}]); k2 = call("runMatchKey", [{"pos": 1, "id": "x", "open": False}])
    assert k1 != k2


def test_typed_id_7_vs_string7_and_duplicates_bind_by_position():
    L = call("runMatchList", RES, [0, 1, 2, 3])
    assert call("runMatchStep", L, 0, "7", 1)["i"] == -1         # "7" is not at position 0
    assert call("runMatchStep", L, 1, 7, 1)["i"] == -1
    s = call("runMatchStep", L, 2, "sup-01", 1)                  # duplicate id: steps to the OTHER copy by position
    assert s["pos"] == 3 and s["id"] == "sup-01"


def test_absent_id_and_key_changes():
    L = call("runMatchList", RES, [4, 5])
    assert L[1] == {"pos": 5}
    k1 = call("runMatchKey", call("runMatchList", RES, [0, 1]))
    k2 = call("runMatchKey", call("runMatchList", RES, [1, 0]))
    k3 = call("runMatchKey", [{"pos": 0, "id": "7"}, {"pos": 1, "id": "7"}])
    assert len({k1, k2, k3}) == 3                                # order and typed id both part of the key


def test_unbound_rows():
    rr = [{"id": 7}, {"id": 7}, {"id": "sup-01"}]
    assert call("unboundRunRows", RES, rr) == [1, 3, 4, 5]
    assert call("unboundRunRows", [{}], [{}]) == []


def test_wiring_static():
    js = (ST / "app.js").read_text()
    html = (ST / "index.html").read_text()
    assert "Next match ›" in js and "‹ Previous match" in js and "Match <b>${st.i + 1}</b> of <b>${nav.L.length}</b> shown" in js
    assert "runMatchList(S.results, idxs, (pos, id) => resolveRow(" in js and "rfNavFresh(nav)" in js and "no other case was opened" in js
    assert "only the case ID is searchable" in js and "in the searchable text" in js
    assert "S.rfindRef = null; S.rfProj = null;" in js and "cannot be opened" in js and "og.pos" in js     # cleared run closes stale search status
    assert "Enter opens the first match" in html and "Esc clears" in html  # t_1ab27b73: one-line rfindNote; the match buttons themselves are asserted in js above
