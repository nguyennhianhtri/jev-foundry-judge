"""t_38bc0c31: a valid key pasted from a phone (zero-width chars, line breaks, quotes, Bearer prefix) must reach Jev
clean, on both the server (_key) and the browser (key_clean.js). 401 message names the key shape + pasted length."""
import json, shutil, subprocess
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from jev_foundry_judge.keyclean import clean_key

ROOT = Path(__file__).resolve().parents[1]
K = "apik_" + "A1b2C3d4" * 12 + "xyz"
CASES = [K, f" {K} ", f"{K[:40]}\n{K[40:]}", f"\u200b{K}\u200d", f"{K[:10]}\u2060{K[10:]}\ufeff", f'"{K}"', f"'{K}'",
         f"\u201c{K}\u201d", f"Bearer {K}", f"bearer:{K}", f'Bearer "{K}"', f'"Bearer {K}"', f"{K}\r\n", f"{K[:5]}\u00a0{K[5:]}",
         f"\t`{K}`\t"]


@pytest.mark.parametrize("raw", CASES)
def test_server_clean(raw):
    assert clean_key(raw) == K


def test_invalid_message_and_length(monkeypatch):
    import main
    from jev_foundry_judge.jev_client import JevClient, JevError
    seen = {}

    def fake_ask(self, state, q):
        seen["key"] = self._key
        raise JevError(401, "bad")
    monkeypatch.setattr(JevClient, "ask", fake_ask)
    c = TestClient(main.app)
    r = c.post("/api/verify-key", headers={"X-Jev-Key": f"Bearer\t {K[:50]}"}, json={})
    assert r.status_code == 401
    d = r.json()["detail"]
    assert "starts with apik" in d and "108" in d and "You pasted 50 characters" in d and "Bearer" in d
    assert seen["key"] == K[:50]
    assert K[:50] not in d  # never echo the key


def test_clean_reaches_jev(monkeypatch):
    import main
    from jev_foundry_judge.jev_client import JevClient, JevResult
    seen = {}

    def ok(self, state, q):
        seen["key"] = self._key
        return JevResult({"ok": {"noul": 1}}, "jev-x", 1, 0, 5.0)
    monkeypatch.setattr(JevClient, "ask", ok)
    r = TestClient(main.app).post("/api/verify-key", headers={"X-Jev-Key": f'"{K[:30]}\n{K[30:]}"'}, json={})
    assert r.status_code == 200 and seen["key"] == K
