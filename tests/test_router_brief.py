"""t_8aac7fcd: routing decision brief is built from the submit-time snapshot + recorded results + visible policy."""
import json, shutil, subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
JS = """
const m = require(process.argv[1]); let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  const a = JSON.parse(s); process.stdout.write(m.routeBrief(a.snap, a.results, a.models, a.fb, a.k, a.meta)); });
"""


def brief(**over):
    snap = {"prompts": ["hi"], "routedAt": "2026-09-29T05:00:00.000Z", "version": "v9",
            "models": [{"key": "small", "name": "nano", "desc": "cheap | fast"}, {"key": "strong", "name": "big", "desc": "hard"}]}
    arg = {"snap": snap, "results": [{"prompt": "hi", "choice": "small", "probabilities": {"small": 0.9, "strong": 0.1},
                                      "confidence": 0.8, "latency_ms": 312.5, "input_tokens": 100, "usd": 0.00001, "model": "jev-1"}],
           # visible model state after the route: name edited later, price changed (price must follow, name must not)
           "models": [{"key": "small", "name": "EDITED", "desc": "x", "in": 1, "out": 2}, {"key": "strong", "name": "big", "desc": "hard", "in": 10, "out": 20}],
           "fb": "strong", "k": {"confT": 0.6, "cheapP": None, "tin": 500, "tout": 400}, "meta": {"now": "2026-09-29T05:01:00Z", "version": "v9"}}
    arg.update(over)
    return subprocess.run(["node", "-e", JS, str(ROOT / "app/static/router.js")], input=json.dumps(arg),
                          capture_output=True, text=True, check=True).stdout


@pytest.mark.skipif(not shutil.which("node"), reason="node")
def test_brief_uses_snapshot_identity_and_visible_policy():
    b = brief()
    assert "Selected model: nano (key small)" in b and "EDITED" not in b
    assert "| small | nano | 1 | 2 | cheap \\| fast |" in b
    assert "312.5 ms" in b and "confidence: 0.800" in b and "(estimate" in b
    assert "no API key" in b.replace("It contains no API key", "no API key")
    assert "$0.00130" in b  # 500*1/1e6 + 400*2/1e6


@pytest.mark.skipif(not shutil.which("node"), reason="node")
def test_brief_policy_change_and_missing_values():
    b = brief(k={"confT": 0.95, "cheapP": None, "tin": 500, "tout": 400},
              results=[{"prompt": "hi", "probabilities": {"small": 0.9, "strong": 0.1}, "confidence": 0.8}])
    assert "Selected model: big (key strong)" in b and "low confidence" in b
    assert "Routing latency (measured Jev call): unavailable" in b and "model unavailable" in b


@pytest.mark.skipif(not shutil.which("node"), reason="node")
def test_brief_cheapest_follows_visible_prices_like_screen():
    """t_b72a0d38: snapshot has no prices; brief must select with the visible prices (same as the screen)."""
    snap = {"prompts": ["x"], "routedAt": "t", "models": [{"key": "small", "name": "S", "desc": "a"},
            {"key": "strong", "name": "B", "desc": "b"}, {"key": "code", "name": "C", "desc": "c"}]}
    res = [{"prompt": "x", "probabilities": {"small": 0.5, "strong": 0.3, "code": 0.2}, "confidence": 0.9}]
    k = {"confT": 0.5, "cheapP": 0.25, "tin": 500, "tout": 400}
    for prices, want in (({"small": (1, 1), "strong": (10, 20), "code": (1, 1)}, "S (key small)"),
                         ({"small": (50, 50), "strong": (10, 20), "code": (1, 1)}, "B (key strong)")):
        live = [{**m, "in": prices[m["key"]][0], "out": prices[m["key"]][1]} for m in snap["models"]]
        b = brief(snap=snap, results=res, models=live, k=k)
        assert f"Selected model: {want}" in b, b
        assert "cheapest good fit" in b
    # identity edits after route never leak; confidence fallback still wins
    b = brief(snap=snap, results=res, models=[{**m, "name": "EDIT", "in": 1, "out": 1} for m in snap["models"]],
              k={**k, "confT": 0.95})
    assert "Selected model: B (key strong)" in b and "EDIT" not in b and "low confidence" in b
