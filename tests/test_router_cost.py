"""t_c8e258d8: cheapest-good-fit uses the token-weighted answer cost (one formula, browser == server)."""
import json, shutil, subprocess
from pathlib import Path

import pytest

from jev_foundry_judge import router as jr

ROOT = Path(__file__).resolve().parents[1]
RJS = str(ROOT / "app/static/router.js")
# Asymmetric user-assumed prices (not market facts): A has cheap output, B has cheap input. Sum rule: A (11 < 13).
M = [{"key": "a", "name": "A", "desc": "a", "in": 10, "out": 1}, {"key": "b", "name": "B", "desc": "b", "in": 1, "out": 12},
     {"key": "strong", "name": "S", "desc": "s", "in": 20, "out": 20}]
P = {"a": .4, "b": .4, "strong": .2}
MIX = [(500, 400, "b"), (4000, 100, "b"), (100, 2000, "a"), (0, 0, "a"), (1, 0, "b"), (0, 1, "a")]


def node(code, arg):
    return json.loads(subprocess.run(["node", "-e", code, RJS], input=json.dumps(arg), capture_output=True, text=True,
                                     check=True).stdout)


def test_server_policy_is_token_weighted():
    for tin, tout, want in MIX:
        assert jr.apply_policy(P, .9, M, "strong", .5, .3, tin, tout)["routed"] == want, (tin, tout)
    # both-zero tie: every cost 0, list order wins; not NaN
    assert [jr.answer_cost(m, 0, 0) for m in M] == [0, 0, 0]
    # unknown/invalid is unavailable, never free, and never wins
    for bad in (None, float("nan"), float("inf"), -1, "1", True):
        assert jr.answer_cost({**M[0], "in": bad}, 500, 400) is None
        assert jr.answer_cost(M[0], bad, 400) is None
    bad_a = [{**M[0], "in": float("nan")}, M[1], M[2]]
    assert jr.apply_policy(P, .9, bad_a, "strong", .5, .3, 100, 2000)["routed"] == "b"
    # confidence fallback still overrides; no clear fit still falls back
    assert jr.apply_policy(P, .1, M, "strong", .5, .3, 500, 400)["routed"] == "strong"
    assert jr.apply_policy(P, .9, M, "strong", .5, .9, 500, 400)["routed"] == "strong"


@pytest.mark.skipif(not shutil.which("node"), reason="node")
def test_browser_server_parity_and_one_formula():
    code = ("const {policy,answerCost}=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);"
            "process.stdout.write(JSON.stringify({r:a.mix.map(([i,o])=>policy(a.p,.9,a.m,'strong',.5,.3,i,o).routed),"
            "c:a.mix.map(([i,o])=>a.m.map(m=>answerCost(m,i,o))),n:[answerCost({in:NaN,out:1},1,1),answerCost({in:1,out:1},NaN,1),"
            "answerCost(null,1,1),answerCost({in:-1,out:1},1,1),answerCost({in:'1',out:1},1,1)]}))})")
    out = node(code, {"p": P, "m": M, "mix": [x[:2] for x in MIX]})
    assert out["r"] == [w for *_, w in MIX] == [jr.apply_policy(P, .9, M, "strong", .5, .3, i, o)["routed"] for i, o, _ in MIX]
    assert out["c"] == [[jr.answer_cost(m, i, o) for m in M] for i, o, _ in MIX]
    assert out["n"] == [None] * 5
    js = (ROOT / "app/static/router.js").read_text()
    assert "b.in + b.out" not in js and js.count("tin * m.in + tout * m.out") == 1 and "k.tin * m.in" not in js


@pytest.mark.skipif(not shutil.which("node"), reason="node")
def test_brief_selects_and_costs_with_token_mix():
    code = ("const m=require(process.argv[1]);let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);"
            "process.stdout.write(JSON.stringify(a.ks.map(k=>m.routeBrief(a.snap,a.res,a.m,'strong',k,{now:'t'}))))})")
    snap = {"prompts": ["x"], "routedAt": "t", "models": [{k: v for k, v in x.items() if k in ("key", "name", "desc")} for x in M]}
    res = [{"prompt": "x", "probabilities": P, "confidence": .9}]
    ks = [{"confT": .5, "cheapP": .3, "tin": i, "tout": o} for i, o, _ in MIX[:3]]
    for b, (i, o, want) in zip(node(code, {"snap": snap, "res": res, "m": M, "ks": ks}), MIX[:3]):
        name = {"a": "A", "b": "B"}[want]
        assert f"Selected model: {name} (key {want})" in b
        c = jr.answer_cost(next(x for x in M if x["key"] == want), i, o)
        assert f"${c:.3g}" in b and "tokens in × $ in + tokens out × $ out" in b
