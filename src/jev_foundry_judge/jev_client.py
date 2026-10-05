"""Minimal Jev (TypeSafe System One) HTTP client. No logging of keys or payloads."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

import os

# Any Jev-compatible System One endpoint works, e.g. a self-hosted open-weight model (see selfhost/).
JEV_URL = os.environ.get("JEV_URL", "https://api.typesafe.ai/v1/systemone")
JEV_MODEL = os.environ.get("JEV_MODEL", "jev-latest")
# docs.typesafe.ai/models: $0.042 per 1M input tokens, output tokens free.
JEV_USD_PER_MTOK_INPUT = 0.042


class JevError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"Jev API {status}: {message}")
        self.status = status


@dataclass
class JevResult:
    answers: dict
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: float
    usd: float = field(init=False)

    def __post_init__(self):
        self.usd = self.input_tokens * JEV_USD_PER_MTOK_INPUT / 1_000_000


class JevClient:
    def __init__(self, api_key: str, model: str = JEV_MODEL, timeout: float = 60, url: str = JEV_URL):
        if not api_key or not api_key.strip():
            raise ValueError("A Jev API key is required")
        self._key = api_key.strip()
        self.model = model
        self.timeout = timeout
        self.url = url

    def __repr__(self) -> str:  # never leak the key
        return f"JevClient(model={self.model!r})"

    def ask(self, state, questions: dict) -> JevResult:
        body = json.dumps({"state": state, "model": self.model, "questions": questions}).encode()
        req = urllib.request.Request(
            self.url, body,
            {"Authorization": f"Bearer {self._key}", "Content-Type": "application/json",
             "User-Agent": "jev-foundry-judge/1.0"})
        last: Exception | None = None
        for attempt in range(4):
            t0 = time.perf_counter()
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    out = json.load(r)
                ms = (time.perf_counter() - t0) * 1000
                u = out.get("usage", {}) or {}
                return JevResult(out["answers"], out.get("model", self.model),
                                 int(u.get("input_tokens", 0)), int(u.get("output_tokens", 0)), ms)
            except urllib.error.HTTPError as e:
                msg = ""
                try:
                    msg = json.loads(e.read().decode()).get("error", {}).get("message", "")
                except Exception:
                    pass
                last = JevError(e.code, msg or e.reason)
                if e.code not in (429, 500, 502, 503, 504):
                    raise last
                ra = e.headers.get("retry-after") if e.headers else None
                time.sleep(float(ra) if ra and ra.replace(".", "").isdigit() else 0.5 * 2 ** attempt)
            except urllib.error.URLError as e:
                last = JevError(0, str(e.reason))
                time.sleep(0.5 * 2 ** attempt)
        raise last  # type: ignore[misc]
