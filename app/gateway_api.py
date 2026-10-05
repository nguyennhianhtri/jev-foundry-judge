"""HTTP surface of the white-label model gateway (portal + APIM callbacks)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from jev_foundry_judge import gateway as gw

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static" / "gateway"
THEMES = ROOT.parent / "gateway" / "themes"
VERSION = os.getenv("APP_VERSION", "dev")
router = APIRouter()


# ---------------------------------------------------------------- auth
def _secret() -> bytes:
    return (os.getenv("GW_SESSION_SECRET") or os.getenv("ANALYTICS_SALT") or "dev-only").encode()


def _check_pw(pw: str) -> bool:
    spec = os.getenv("GW_ADMIN_HASH") or ""
    if not spec:
        return os.getenv("GW_OPEN") == "1"
    try:
        _, it, salt, dk = spec.split("$")
        got = hashlib.pbkdf2_hmac("sha256", pw.encode(), base64.b64decode(salt), int(it))
        return hmac.compare_digest(got, base64.b64decode(dk))
    except Exception:
        return False


def _cookie(exp: int) -> str:
    sig = hmac.new(_secret(), str(exp).encode(), hashlib.sha256).hexdigest()[:32]
    return f"{exp}.{sig}"


def _authed(request: Request) -> bool:
    if os.getenv("GW_OPEN") == "1" and not os.getenv("GW_ADMIN_HASH"):
        return True
    c = request.cookies.get("gw_s") or ""
    try:
        exp, _ = c.split(".", 1)
        return int(exp) > time.time() and hmac.compare_digest(c, _cookie(int(exp)))
    except Exception:
        return False


def _need(request: Request) -> None:
    if not _authed(request):
        raise HTTPException(401, "Sign in first")


def _internal(request: Request) -> None:
    want = os.getenv("GW_INTERNAL_TOKEN") or ""
    got = request.headers.get("x-gw-internal") or ""
    if not want or not hmac.compare_digest(want, got):
        raise HTTPException(403, "forbidden")


# ---------------------------------------------------------------- theme
def theme() -> dict:
    name = os.getenv("GW_THEME", "default")
    p = THEMES / f"{Path(name).name}.json"
    if not p.exists():
        p = THEMES / "default.json"
    return json.loads(p.read_text())


# ---------------------------------------------------------------- pages
@router.get("/gateway")
def page():
    return FileResponse(STATIC / "index.html")


@router.get("/api/gw/theme")
def api_theme():
    t = theme()
    return {**t, "version": VERSION, "endpoint": os.getenv("GW_PUBLIC_ENDPOINT", "").rstrip("/")}


@router.get("/api/gw/session")
def session(request: Request):
    return {"signed_in": _authed(request)}


@router.post("/api/gw/login")
async def login(request: Request):
    body = await request.json()
    pw = str((body or {}).get("password") or "")
    if not _check_pw(pw):
        time.sleep(0.4)
        raise HTTPException(401, "Wrong password")
    exp = int(time.time()) + 12 * 3600
    r = JSONResponse({"ok": True})
    r.set_cookie("gw_s", _cookie(exp), max_age=12 * 3600, httponly=True, secure=request.url.scheme == "https"
                 or request.headers.get("x-forwarded-proto") == "https", samesite="strict")
    return r


@router.post("/api/gw/logout")
def logout():
    r = JSONResponse({"ok": True})
    r.delete_cookie("gw_s")
    return r


@router.get("/api/gw/catalogue")
def api_catalogue():
    return {"models": gw.catalogue(), "currency": theme().get("currency", "USD"),
            "price_source": "Azure retail prices API, eastus2 meters, read 2026-10-05; USD per 1M tokens"}


# ---------------------------------------------------------------- APIM callbacks (internal token)
@router.post("/api/gw/decide")
async def decide(request: Request):
    _internal(request)
    b = await request.json()
    try:
        d = gw.decide(str(b.get("sub") or ""), str(b.get("model") or "auto"), str(b.get("prompt") or ""),
                      jev_key=request.headers.get("x-jev-key"))
    except gw.Reject as e:
        gw.meter({"sub": b.get("sub"), "requested": b.get("model"), "reason": e.code, "status": e.status})
        return {"allow": False, "status": e.status, "code": e.code, "message": e.msg}
    return d


@router.post("/api/gw/meter")
async def meter(request: Request):
    _internal(request)
    b = await request.json()
    rec = gw.meter(b if isinstance(b, dict) else {})
    gw._note_spend(rec["sub"], rec["usd"])
    return Response(status_code=204)


# ---------------------------------------------------------------- playground (server holds the key)
@router.post("/api/gw/chat")
async def chat(request: Request):
    _need(request)
    b = await request.json()
    msgs = b.get("messages")
    if not isinstance(msgs, list) or not msgs:
        raise HTTPException(400, "Type a message first")
    base = os.getenv("GW_APIM_URL", "").rstrip("/")
    if not base:
        raise HTTPException(503, "Gateway URL is not configured on this host")
    key = request.headers.get("x-gw-key") or gw.playground_key()
    body = {"model": str(b.get("model") or "auto"), "messages": msgs[-20:],
            "max_completion_tokens": min(int(b.get("max_tokens") or 800), 2000)}
    if isinstance(b.get("temperature"), (int, float)):
        body["temperature"] = max(0.0, min(2.0, float(b["temperature"])))
    req = urllib.request.Request(base + "/chat/completions", json.dumps(body).encode(),
                                 {"api-key": key, "Content-Type": "application/json"})
    t0 = time.perf_counter()
    import asyncio

    def call():
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers or {}), e.read()
    st, hd, raw = await asyncio.get_running_loop().run_in_executor(None, call)
    ms = round((time.perf_counter() - t0) * 1000)
    h = {k.lower(): v for k, v in hd.items()}
    try:
        o = json.loads(raw or b"{}")
    except Exception:
        o = {"error": {"message": raw[:300].decode("utf-8", "replace")}}
    meta = {k: h.get("x-gateway-" + k, "") for k in ("model", "reason", "confidence", "classifier", "cost-usd")}
    if st != 200:
        msg = (o.get("error") or {}).get("message") if isinstance(o.get("error"), dict) else None
        return JSONResponse({"error": msg or o.get("message") or f"Gateway returned {st}", "status": st,
                             "meta": meta, "latency_ms": ms}, status_code=200)
    u = o.get("usage") or {}
    m = meta["model"]
    usd = gw.cost_usd(m, int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0))
    return {"text": ((o.get("choices") or [{}])[0].get("message") or {}).get("content") or "", "meta": meta,
            "prompt_tokens": u.get("prompt_tokens", 0), "completion_tokens": u.get("completion_tokens", 0),
            "latency_ms": ms, "usd": usd, "status": st}


# ---------------------------------------------------------------- usage + admin
@router.get("/api/gw/usage")
def api_usage(request: Request):
    _need(request)
    return gw.usage()


@router.get("/api/gw/admin")
def admin_get(request: Request):
    _need(request)
    cfg = gw.STORE.get(fresh=True)
    return {"config": cfg, "models": [m["id"] for m in gw.CATALOGUE],
            "selfhost": gw.selfhost_status(), "backend": "apim" if gw.STORE.apim else "file"}


@router.put("/api/gw/policy")
async def admin_policy(request: Request):
    _need(request)
    b = await request.json()
    cfg = gw.STORE.get(fresh=True)
    cfg["policy"] = {**cfg["policy"], **(b or {})}
    return {"config": gw.STORE.put(cfg)}


def _key_args(b: dict) -> tuple:
    models = b.get("models", "*")
    if models != "*" and (not isinstance(models, list) or not models):
        raise HTTPException(400, "Pick at least one model, or allow all")
    try:
        cpm, credits = int(b.get("cpm", 30)), float(b.get("credits_usd", 5))
    except (TypeError, ValueError):
        raise HTTPException(400, "Limits must be numbers")
    if not 1 <= cpm <= 10000 or not 0 <= credits <= 1e6:
        raise HTTPException(400, "Requests per minute must be 1 to 10000 and credits 0 or more")
    return models, cpm, credits


@router.post("/api/gw/keys")
async def key_create(request: Request):
    _need(request)
    b = await request.json()
    name = str(b.get("name") or "").strip()[:40]
    if not name:
        raise HTTPException(400, "Give the key a name")
    models, cpm, credits = _key_args(b)
    try:
        return gw.create_key(name, models, cpm, credits)
    except urllib.error.HTTPError as e:
        raise HTTPException(502, f"APIM refused the key ({e.code})")


@router.put("/api/gw/keys/{sid}")
async def key_update(sid: str, request: Request):
    _need(request)
    b = await request.json()
    cfg = gw.STORE.get(fresh=True)
    if sid not in cfg["keys"] and sid != "playground":
        raise HTTPException(404, "No such key")
    models, cpm, credits = _key_args(b)
    cur = cfg["keys"].get(sid) or {"name": sid}
    cfg["keys"][sid] = {**cur, "models": models, "cpm": cpm, "credits_usd": credits}
    return {"config": gw.STORE.put(cfg)}


@router.delete("/api/gw/keys/{sid}")
def key_delete(sid: str, request: Request):
    _need(request)
    if sid == "playground":
        raise HTTPException(400, "The playground key can't be deleted")
    gw.delete_key(sid)
    return {"ok": True}
