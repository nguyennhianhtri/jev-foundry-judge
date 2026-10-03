from fastapi.testclient import TestClient
from app import main

def _k(h):
    class R:  # minimal request stand-in
        headers = {"x-jev-key": h}
    return main._key(R())

def test_strips_phone_paste_noise():
    base = "apik_" + "a" * 103
    for raw in [base, " " + base + "\n", base[:50] + "\u200b" + base[50:], '"' + base + '"', "Bearer " + base, base[:40] + "\n" + base[40:], "\ufeff" + base]:
        assert _k(raw) == base
