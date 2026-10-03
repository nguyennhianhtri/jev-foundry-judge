"""t_8395031b: privacy-light analytics + password-protected /stats."""
import base64
import re
from pathlib import Path

from fastapi.testclient import TestClient

import main
from jev_foundry_judge import analytics as A

ST = Path(__file__).resolve().parents[1] / "app" / "static"
UA_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148"


def _auth(pw):
    return {"Authorization": "Basic " + base64.b64encode(f"x:{pw}".encode()).decode()}


def setup_function(_):
    A.RING.clear()


def test_visitor_hash_rotates_daily_and_hides_ip(monkeypatch):
    monkeypatch.setenv("ANALYTICS_SALT", "s")
    a, b = A.visitor("1.2.3.4", "ua", "2026-09-29"), A.visitor("1.2.3.4", "ua", "2026-09-30")
    assert a != b and len(a) == 16 and "1.2.3.4" not in a
    assert A.visitor("1.2.3.4", "ua", "2026-09-29") == a


def test_device_and_ref_host():
    assert A.device(UA_PHONE) == "phone" and A.device("Mozilla/5.0 (Windows NT 10.0)") == "desktop"
    assert A.ref_host("https://teams.microsoft.com/l/chat/19:abc?x=secret") == "teams.microsoft.com"
    assert A.ref_host("") == "(direct)" and A.ref_host("https://jev.x.azurecontainerapps.io/") == "(direct)"


def test_props_allow_list_drops_prompts_and_keys():
    c = TestClient(main.app)
    r = c.post("/api/t", json={"e": "page_view", "p": {"route": "/evaluate", "ref": "https://teams.microsoft.com/x?q=1",
                                                         "prompt": "SECRET PROMPT", "key": "jev_sk_123"}},
               headers={"user-agent": UA_PHONE, "x-forwarded-for": "9.9.9.9"})
    assert r.status_code == 204
    ev = A.RING[-1]
    assert ev["route"] == "/evaluate" and ev["ref"] == "teams.microsoft.com" and ev["device"] == "phone"
    blob = repr(list(A.RING))
    for bad in ("SECRET", "jev_sk", "9.9.9.9", "/x?q"):
        assert bad not in blob
    # server-only events can't be forged from the browser; unknown events ignored
    for e in ("key_connected", "route_run", "answer_fetched", "nope"):
        c.post("/api/t", json={"e": e, "p": {"ok": True}})
    assert [x["name"] for x in A.RING] == ["page_view"]


def test_no_cookies_set():
    c = TestClient(main.app)
    for r in (c.get("/"), c.get("/evaluate"), c.post("/api/t", json={"e": "page_view"})):
        assert "set-cookie" not in {k.lower() for k in r.headers}


def test_route_run_and_key_connected_recorded(monkeypatch):
    class FakeClient:
        def __init__(self, *a, **k): pass
        def ask(self, *a, **k):
            class R: model, latency_ms = "jev", 1.0
            return R()
    monkeypatch.setattr(main, "JevClient", FakeClient)
    monkeypatch.setattr(main.jrouter, "route", lambda cl, p, ms: {"routed": "m0"})
    c = TestClient(main.app)
    assert c.post("/api/verify-key", headers={"x-jev-key": "k"}).status_code == 200
    r = c.post("/api/router/route", headers={"x-jev-key": "k"}, json={"prompts": ["top secret a", "b", "c"]})
    assert r.status_code == 200
    names = [(e["name"], e.get("ok"), e.get("n")) for e in A.RING]
    assert ("key_connected", True, None) in names and ("route_run", None, 3) in names
    assert "top secret" not in repr(list(A.RING))


def test_summarize_funnel_referrers_devices():
    ev = [
        {"t": "2026-09-29T01:00:00Z", "name": "page_view", "v": "a", "ref": "teams.microsoft.com", "device": "desktop"},
        {"t": "2026-09-29T01:01:00Z", "name": "page_view", "v": "a", "ref": "(direct)", "device": "desktop"},
        {"t": "2026-09-29T01:02:00Z", "name": "key_connected", "v": "a", "ok": "True"},
        {"t": "2026-09-29T01:03:00Z", "name": "route_run", "v": "a", "n": "2"},
        {"t": "2026-09-29T02:00:00Z", "name": "page_view", "v": "b", "ref": "teams.microsoft.com", "device": "phone"},
        {"t": "2026-09-29T02:01:00Z", "name": "key_connected", "v": "b", "ok": "False"},
        {"t": "2026-09-30T02:00:00Z", "name": "page_view", "v": "c", "ref": "(direct)", "device": "phone"},
    ]
    s = A.summarize(ev)
    assert s["per_day"] == [{"day": "2026-09-29", "visitors": 2, "views": 3}, {"day": "2026-09-30", "visitors": 1, "views": 1}]
    assert s["funnel"] == {"visited": 3, "connected": 1, "ran": 1}
    assert s["referrers"][0] == ("teams.microsoft.com", 2)
    assert s["devices"] == {"desktop": 2, "phone": 2}
    assert len(s["last"]) == 7 and s["last"][0]["t"].startswith("2026-09-30")


def test_stats_requires_password(monkeypatch):
    monkeypatch.setenv("STATS_PASSWORD_HASH", A.make_hash("correct horse", 1000))
    monkeypatch.delenv("APPINSIGHTS_APP_ID", raising=False)
    c = TestClient(main.app)
    r = c.get("/stats")
    assert r.status_code == 401 and "Basic" in r.headers["www-authenticate"]
    assert c.get("/stats", headers=_auth("wrong")).status_code == 401
    c.post("/api/t", json={"e": "page_view", "p": {"route": "/"}})
    ok = c.get("/stats", headers=_auth("correct horse"))
    assert ok.status_code == 200
    for h in ("Funnel", "Per day", "Top referrers", "Devices", "Last 20 events"):
        assert h in ok.text
    assert "set-cookie" not in {k.lower() for k in ok.headers}


def test_stats_locked_when_no_hash_configured(monkeypatch):
    monkeypatch.delenv("STATS_PASSWORD_HASH", raising=False)
    assert TestClient(main.app).get("/stats", headers=_auth("")).status_code == 401


def test_pages_load_tracker_and_footer_note():
    for f in ("router.html", "index.html"):
        h = (ST / f).read_text()
        assert '<script src="/static/analytics.js"></script>' in h
        assert "Anonymous visit counts, no cookies." in h
    js = (ST / "analytics.js").read_text()
    assert not re.search(r"document\.cookie|localStorage|sessionStorage|https?://(?!.*none)", js.replace("new URL(document.referrer).origin", ""))
