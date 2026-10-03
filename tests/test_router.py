"""t_38bc0c31: Jev Choice model router — policy parity (server vs browser), endpoint validation, exec cap."""
import json, shutil, subprocess
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from jev_foundry_judge import router as jr
from jev_foundry_judge.jev_client import JevClient, JevError, JevResult

ROOT = Path(__file__).resolve().parents[1]
M = jr.DEFAULT_MODELS
CASES = [({"small": .7, "strong": .2, "code": .1}, .8, .6, None), ({"small": .5, "strong": .45, "code": .05}, .3, .6, None),
         ({"small": .3, "strong": .6, "code": .1}, .9, .6, .25), ({"small": .1, "strong": .1, "code": .8}, .9, .6, .25),
         ({"small": .2, "strong": .2, "code": .2}, .9, 0, .5), ({"small": .26, "strong": .5, "code": .24}, .4, .5, .25)]


def test_policy_rules():
    assert jr.apply_policy(*CASES[0][:2], M, "strong", .6, None)["routed"] == "small"
    assert jr.apply_policy(*CASES[1][:2], M, "strong", .6, None)["routed"] == "strong"  # low confidence
    assert jr.apply_policy(*CASES[2][:2], M, "strong", .6, .25, 500, 400)["routed"] == "small"   # cheapest above p
    assert jr.apply_policy(*CASES[4][:2], M, "strong", 0, .5, 500, 400)["routed"] == "strong"    # none above p


@pytest.mark.skipif(not shutil.which("node"), reason="node")
def test_browser_policy_matches_server():
    code = ("const {policy}=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);"
            "process.stdout.write(JSON.stringify(a.cases.map(c=>policy(c[0],c[1],a.models,'strong',c[2],c[3],500,400).routed)))})")
    out = subprocess.run(["node", "-e", code, str(ROOT / "app/static/router.js")], input=json.dumps({"cases": CASES, "models": M}),
                         capture_output=True, text=True, check=True)
    assert json.loads(out.stdout) == [jr.apply_policy(p, c, M, "strong", t, x, 500, 400)["routed"] for p, c, t, x in CASES]


@pytest.fixture
def client(monkeypatch):
    import main
    def ask(self, state, q):
        assert set(q["route"]["criteria"]) == {"small", "strong", "code"} and q["route"]["type"] == "choice"
        return JevResult({"route": {"type": "choice", "choice": "code", "confidence": .9,
                                    "probabilities": {"small": .05, "strong": .05, "code": .9}}}, "jev-x", 400, 0, 250.0)
    monkeypatch.setattr(JevClient, "ask", ask)
    return TestClient(main.app), main


def test_route_endpoint(client):
    c, _ = client
    r = c.post("/api/router/route", headers={"X-Jev-Key": "apik_x"}, json={"prompts": ["write code", "more"]})
    assert r.status_code == 200
    res = r.json()["results"]
    assert len(res) == 2 and res[0]["choice"] == "code" and res[0]["probabilities"]["code"] == .9 and res[0]["latency_ms"] == 250.0
    assert res[0]["usd"] == pytest.approx(400 * 0.042 / 1e6)


@pytest.mark.parametrize("body,code", [({"prompts": []}, 400), ({"prompts": [""]}, 400), ({"prompts": ["x"] * 51}, 400),
                                       ({"prompts": ["x"], "models": [M[0]]}, 400),
                                       ({"prompts": ["x"], "models": [{**M[0], "desc": ""}, M[1]]}, 400),
                                       ({"prompts": ["x"], "models": [M[0], {**M[1], "key": "small"}]}, 400)])
def test_route_validation(client, body, code):
    c, _ = client
    assert c.post("/api/router/route", headers={"X-Jev-Key": "k"}, json=body).status_code == code


def test_route_needs_key(client):
    c, _ = client
    assert c.post("/api/router/route", json={"prompts": ["x"]}).status_code == 401


def test_route_401_message(monkeypatch):
    import main
    monkeypatch.setattr(JevClient, "ask", lambda *a: (_ for _ in ()).throw(JevError(401, "no")))
    r = TestClient(main.app).post("/api/router/route", headers={"X-Jev-Key": "abc"}, json={"prompts": ["x"]})
    assert r.status_code == 401 and "starts with apik" in r.json()["detail"]


def test_execute_cap_and_scope(client, monkeypatch):
    c, main = client
    monkeypatch.setenv("AOAI_ENDPOINT", "https://x"); monkeypatch.setenv("AOAI_DEPLOYMENT", "d")
    monkeypatch.setattr(jr, "execute", lambda dep, p, max_tokens=600: {"text": "hi", "latency_ms": 1, "prompt_tokens": 10,
                                                                      "completion_tokens": 5, "finish_reason": "stop"})
    monkeypatch.setattr(main, "ROUTER_EXEC_PER_HOUR", 2); main._rx_window.clear()
    h = {"X-Jev-Key": "k"}
    assert c.post("/api/router/execute", headers=h, json={"model": "other", "prompt": "x"}).status_code == 400
    r = c.post("/api/router/execute", headers=h, json={"model": "small", "prompt": "x"})
    assert r.status_code == 200 and r.json()["deployment"] == "router-gpt-5-4-nano" and r.json()["usd"] == pytest.approx((10 * .2 + 5 * 1.25) / 1e6)
    assert c.post("/api/router/execute", headers=h, json={"model": "small", "prompt": "x"}).status_code == 200
    assert c.post("/api/router/execute", headers=h, json={"model": "small", "prompt": "x"}).status_code == 429
    assert c.post("/api/router/execute", json={"model": "small", "prompt": "x"}).status_code == 401


def test_page_served(client):
    c, _ = client
    r = c.get("/router")  # t_a650cc28: redirects to the home page
    assert r.status_code == 200 and "<title>Jev Router" in r.text and 'name="description"' in r.text and "router.js" in r.text
    assert c.get("/api/router/config").json()["models"][0]["name"] == "gpt-5.4-nano"


@pytest.mark.skipif(not shutil.which("node"), reason="node")
def test_result_bound_to_submitted_input_t_b1373def():
    """A route result is tied to the exact prompts + model name/desc submitted; prices/knobs don't invalidate it."""
    code = ("const {inputSig}=require(process.argv[1]);const m=[{key:'small',name:'A',desc:'x',in:1,out:2}];"
            "const s=inputSig(['p'],m);const r=[s===inputSig(['p'],[{...m[0],in:9,out:9}]),s===inputSig(['p2'],m),"
            "s===inputSig(['p'],[{...m[0],desc:'y'}]),s===inputSig(['p'],[{...m[0],name:'B'}]),s===inputSig(['p','q'],m)];"
            "process.stdout.write(JSON.stringify(r))")
    out = subprocess.run(["node", "-e", code, str(ROOT / "app/static/router.js")], capture_output=True, text=True, check=True)
    assert json.loads(out.stdout) == [True, False, False, False, False]
    js = (ROOT / "app/static/router.js").read_text()
    assert "R.resSig = sig" in js and "!stale && !noCost && R.cfg?.exec_enabled" in js and "if (isStale() || problems().length)" in js
    assert "R.stale" not in js  # no unconditional stale reset after a late reply
