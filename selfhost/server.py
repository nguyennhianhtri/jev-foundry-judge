"""Jev-compatible System One endpoint for an open-weight decision model (default: Cloudflare Clef-flash).

POST /v1/systemone takes the same body as api.typesafe.ai/v1/systemone and returns the same
`answers` shape, so the judge, the router and APIM can point at it by changing one URL.

Auth: if SELFHOST_API_KEY is set, requests must send `Authorization: Bearer <key>`.
Run:  MODEL_DIR=/opt/models/clef-flash uvicorn server:app --host 0.0.0.0 --port 8700
"""
from __future__ import annotations

import hmac
import os
import sys
import threading
import time

import torch
from fastapi import FastAPI, Header, HTTPException, Request

MODEL_DIR = os.environ.get("MODEL_DIR", "/opt/models/clef-flash")
MODEL_NAME = os.environ.get("MODEL_NAME", "clef-flash")
API_KEY = os.environ.get("SELFHOST_API_KEY", "")
DEVICE = os.environ.get("DEVICE", "cuda" if torch.cuda.is_available() else "cpu")

sys.path.insert(0, MODEL_DIR)
from joint_schema_model import load_release_model, systemone  # noqa: E402  (ships with the model weights)

if DEVICE == "cpu":
    torch.set_num_threads(int(os.environ.get("THREADS", os.cpu_count() or 4)))
model, processor = load_release_model(MODEL_DIR, device=DEVICE)
_lock = threading.Lock()  # one forward pass at a time; CPU throughput does not improve with concurrency
app = FastAPI(title="Self-hosted System One")


def _auth(authorization: str | None) -> None:
    if not API_KEY:
        return
    tok = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(tok, API_KEY):
        raise HTTPException(401, {"error": {"message": "invalid api key"}})


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "device": DEVICE}


@app.post("/v1/systemone")
async def system_one(request: Request, authorization: str | None = Header(default=None)):
    _auth(authorization)
    body = await request.json()
    if not isinstance(body.get("questions"), dict) or "state" not in body:
        raise HTTPException(400, {"error": {"message": "state and questions are required"}})
    body["model"] = MODEL_NAME
    t0 = time.perf_counter()
    with _lock, torch.inference_mode():
        out = systemone(model, processor, body)
    out.setdefault("model", MODEL_NAME)
    out.setdefault("usage", {"input_tokens": 0, "output_tokens": 0})
    out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return out
