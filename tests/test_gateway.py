import json

import pytest

from jev_foundry_judge import gateway as gw


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(gw.STORE, "apim", "")
    monkeypatch.setattr(gw.STORE, "path", str(tmp_path / "cfg.json"))
    gw.STORE._cache = None
    gw._rate.clear()
    gw._spend_base.update(at=0.0, by={})
    gw._ring.clear()
    yield


def fake_route(probs, conf=0.9):
    return lambda prompt, cards: {"probabilities": {c["key"]: probs.get(c["key"], 0.0) for c in cards},
                                  "confidence": conf, "latency_ms": 5}


def test_auto_picks_cheapest_above_threshold():
    d = gw.decide("k1", "auto", "hi", route_fn=fake_route({"gpt-5.4-nano": 0.7, "gpt-5.4": 0.3}))
    assert d["model"] == "gpt-5.4-nano" and d["pool"] == "nano" and d["confidence"] == "0.900"


def test_low_confidence_falls_back():
    d = gw.decide("k1", "auto", "hi", route_fn=fake_route({"gpt-5.4-nano": 0.5, "gpt-5.4-mini": 0.5}, conf=0.3))
    assert d["model"] == "gpt-5.4" and "fell back to gpt-5.4" in d["reason"]


def test_classifier_error_falls_back():
    def boom(p, c):
        raise RuntimeError("x")
    assert gw.decide("k1", "auto", "hi", route_fn=boom)["model"] == "gpt-5.4"


def test_allow_list_rate_and_credits():
    cfg = gw.STORE.get()
    cfg["keys"]["k2"] = {"name": "pilot", "models": ["gpt-5.4-nano"], "cpm": 2, "credits_usd": 1}
    gw.STORE.put(cfg)
    with pytest.raises(gw.Reject) as e:
        gw.decide("k2", "gpt-5.4", "hi")
    assert e.value.status == 403
    # second call: allow-list rejects before the rate counter, so 2 calls fit
    assert gw.decide("k2", "gpt-5.4-nano", "hi")["model"] == "gpt-5.4-nano"
    assert gw.decide("k2", "auto", "hi")["reason"] == "only allowed model"
    with pytest.raises(gw.Reject) as e:
        gw.decide("k2", "gpt-5.4-nano", "hi")
    assert e.value.status == 429
    gw._rate.clear()
    gw._spend_base.update(by={"k2": 2.0}, at=9e12)
    with pytest.raises(gw.Reject) as e:
        gw.decide("k2", "gpt-5.4-nano", "hi")
    assert e.value.status == 402


def test_budget_guard_uses_cheapest():
    gw._spend_base.update(by={"k3": 4.5}, at=9e12)  # 90% of default 5 USD
    d = gw.decide("k3", "auto", "prove a theorem", route_fn=fake_route({"gpt-5.4": 1.0}))
    assert d["model"] == "deepseek-v4-flash" and "budget guard" in d["reason"]


def test_unknown_model_404_and_meter_cost():
    with pytest.raises(gw.Reject) as e:
        gw.decide("k1", "gpt-9", "hi")
    assert e.value.status == 404
    r = gw.meter({"sub": "k1", "model": "gpt-5.4", "prompt_tokens": 1000, "completion_tokens": 100, "status": 200})
    assert r["usd"] == pytest.approx((1000 * 2.5 + 100 * 15) / 1e6)
    u = gw.usage()
    assert any(k["id"] == "k1" and k["calls"] == 1 for k in u["keys"])


def test_themes_and_white_label():
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[1]
    for t in (root / "gateway" / "themes").glob("*.json"):
        d = json.loads(t.read_text())
        assert {"name", "accent", "currency", "logo_text"} <= set(d)
    banned = ("sing" + "tel", "ar" + "us")
    for p in [*(root / "app" / "static" / "gateway").iterdir(), *(root / "gateway").rglob("*.*"),
              root / "src" / "jev_foundry_judge" / "gateway.py", root / "app" / "gateway_api.py",
              root / "infra" / "apim" / "policy-gateway.xml"]:
        if p.is_file() and p.suffix in (".json", ".js", ".css", ".html", ".py", ".xml", ".md"):
            low = p.read_text(errors="ignore").lower()
            assert not any(f" {b}" in low or f"{b} " in low or f'"{b}' in low for b in banned), p
