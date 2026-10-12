"""Authentication variants of JevClient: Jev (Bearer), Azure endpoints (api-key header), Microsoft Entra ID."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from jev_foundry_judge import jev_client
from jev_foundry_judge.jev_client import JevClient, JevError

OK = {"model": "microsoft-decision-1", "answers": {"q": {"type": "noul", "noul": 0.9}}, "usage": {"input_tokens": 5, "output_tokens": 1}}


class Stub:
    def __init__(self, replies):
        self.replies, self.seen = list(replies), []
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                outer.seen.append({"auth": self.headers.get("Authorization"), "api_key": self.headers.get("api-key"),
                                   "body": json.loads(self.rfile.read(int(self.headers["Content-Length"])))})
                code, body, headers = outer.replies.pop(0) if len(outer.replies) > 1 else outer.replies[0]
                data = json.dumps(body).encode()
                self.send_response(code)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_port}/x"

    def close(self):
        self.server.shutdown()


@pytest.fixture
def stub():
    made = []

    def make(replies):
        s = Stub(replies)
        made.append(s)
        return s
    yield make
    for s in made:
        s.close()


Q = {"q": {"type": "noul", "instructions": "ok?"}}


def test_bearer_key_for_non_azure_endpoints(stub):
    s = stub([(200, OK, {})])
    JevClient("k1", url=s.url).ask("x", Q)
    assert s.seen[0]["auth"] == "Bearer k1" and s.seen[0]["api_key"] is None


def test_azure_endpoints_use_api_key_header(stub):
    s = stub([(200, OK, {})])
    c = JevClient("k2", url=s.url)
    c.url = "https://res.cognitiveservices.azure.com/providers/microsoft/v1/systemone"
    assert c._auth_headers() == {"api-key": "k2"}


def test_entra_uses_a_cached_bearer_token(stub, monkeypatch):
    calls = []
    monkeypatch.setattr(jev_client, "_entra_token", lambda: calls.append(1) or "entra-token-not-real")
    s = stub([(200, OK, {})])
    c = JevClient("entra", url=s.url)
    c.ask("x", Q)
    c.ask("x", Q)
    assert s.seen[0]["auth"] == "Bearer entra-token-not-real"
    assert len(calls) == 2  # the module-level cache lives inside _entra_token; the client asks per request


def test_model_names_rotate_across_deployments(stub):
    s = stub([(200, OK, {})])
    c = JevClient("k", model="dep-a, dep-b", url=s.url)
    for _ in range(4):
        c.ask("x", Q)
    assert [r["body"]["model"] for r in s.seen] == ["dep-a", "dep-b", "dep-a", "dep-b"]


def test_429_waits_for_retry_after_ms_then_succeeds(stub, monkeypatch):
    slept = []
    monkeypatch.setattr(jev_client.time, "sleep", lambda t: slept.append(t))
    s = stub([(429, {"error": {"message": "slow down"}}, {"retry-after-ms": "2500"}), (200, OK, {})])
    out = JevClient("k", url=s.url).ask("x", Q)
    assert out.answers["q"]["noul"] == 0.9
    assert slept and 2.5 <= slept[0] < 3


def test_529_busy_is_retried_and_401_is_not(stub, monkeypatch):
    monkeypatch.setattr(jev_client.time, "sleep", lambda t: None)
    s = stub([(529, {}, {}), (200, OK, {})])
    assert JevClient("k", url=s.url).ask("x", Q).answers
    bad = stub([(401, {"error": {"message": "no"}}, {})])
    with pytest.raises(JevError):
        JevClient("k", url=bad.url).ask("x", Q)
    assert len(bad.seen) == 1
