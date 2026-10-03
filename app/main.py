"""Jev Foundry Judge web app. Stateless: the dataset lives in the browser.

Security posture:
  * The visitor's Jev key arrives per request in the `X-Jev-Key` header, is used for that
    request only, and is never stored, logged or echoed. Access logs are disabled.
  * There is NO server-side Jev key fallback.
  * The optional LLM-judge baseline uses the host's Azure OpenAI deployment via managed
    identity and is bounded (rows per request + per-instance hourly budget).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from jev_foundry_judge import analytics, baseline, foundry_run
from jev_foundry_judge.evaluators import LEVELS_5, METRICS, JevAgentJudge, SPECS
from jev_foundry_judge import router as jrouter
from jev_foundry_judge.keyclean import INVALID_MSG, clean_key
from jev_foundry_judge.jev_client import JEV_USD_PER_MTOK_INPUT, JevClient, JevError
from jev_foundry_judge.mutations import MUTATIONS, generate
from jev_foundry_judge.stats import summarize

ROOT = Path(__file__).resolve().parent
SAMPLES = Path(os.getenv("SAMPLES_DIR", ROOT.parent / "samples"))
VERSION = os.getenv("APP_VERSION", "dev")
MAX_ROWS = int(os.getenv("MAX_ROWS_PER_REQUEST", "25"))
MAX_BODY = 2_000_000
FOUNDRY_MAX_ROWS = int(os.getenv("FOUNDRY_MAX_ROWS", "60"))
_fnd_lock = threading.Lock()
BASELINE_ROWS_PER_HOUR = int(os.getenv("BASELINE_ROWS_PER_HOUR", "120"))

app = FastAPI(title="Jev Foundry Judge", docs_url=None, redoc_url=None, openapi_url=None)
_pool = ThreadPoolExecutor(max_workers=16)
_bl_pool = ThreadPoolExecutor(max_workers=24)
_bl_lock = threading.Lock()
_bl_window: list[float] = []


def _baseline_allow(n: int) -> bool:
    with _bl_lock:
        now = time.time()
        while _bl_window and now - _bl_window[0] > 3600:
            _bl_window.pop(0)
        if len(_bl_window) + n > BASELINE_ROWS_PER_HOUR:
            return False
        _bl_window.extend([now] * n)
        return True


@app.middleware("http")
async def headers(request: Request, call_next):
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > MAX_BODY:
        return JSONResponse({"error": "request too large"}, 413)
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; "
        "connect-src 'self'; frame-ancestors 'none'")
    return resp


def _key(request: Request) -> str:
    raw = request.headers.get("x-jev-key") or ""
    k = clean_key(raw)
    st = getattr(request, "state", None)
    if st is not None:
        st.key_len, st.key_changed = len(k), k != raw
    if not k:
        raise HTTPException(401, "Paste your Jev API key first")
    if len(k) > 400:
        raise HTTPException(400, "Key looks malformed")
    return k


def _track(request: Request, name: str, **props) -> None:
    ip = analytics.client_ip(request.headers, request.client.host if request.client else None)
    analytics.record(name, props, ip, request.headers.get("user-agent") or "")


def _invalid(request: Request) -> str:
    extra = " after removing spaces, line breaks, quotes or a Bearer prefix" if getattr(request.state, "key_changed", False) else ""
    return INVALID_MSG.format(n=getattr(request.state, "key_len", 0), extra=extra)


@app.get("/api/config")
def config():
    b = baseline.info()
    return {"version": VERSION, "metrics": METRICS, "levels": {m: LEVELS_5[m] for m in METRICS}, "max_rows_per_request": MAX_ROWS,
            "jev_usd_per_mtok_input": JEV_USD_PER_MTOK_INPUT,
            "baseline": {"enabled": b["enabled"], "label": f"Foundry built-in LLM judge ({b['model']}, host-paid, capped)",
                         "usd_per_mtok_in": b["usd_per_mtok_in"], "usd_per_mtok_out": b["usd_per_mtok_out"],
                         "rows_per_hour": BASELINE_ROWS_PER_HOUR},
            "foundry": {"enabled": bool(foundry_run.project_endpoint()),
                        "project": foundry_run.project_endpoint().rsplit("/", 1)[-1],
                        "portal_url": foundry_run.portal_project_url(), "max_rows": FOUNDRY_MAX_ROWS},
            "mutations": list(MUTATIONS),
            "atoms": {m: [{"key": a.key, "label": a.label, "type": a.question["type"], "weight": a.weight,
                           "invert": a.invert, "critical": a.critical,
                           "question": a.question["instructions"]} for a in SPECS[m]["atoms"]] for m in METRICS}}


@app.get("/api/samples")
def samples():
    out = []
    for p in sorted(SAMPLES.glob("*.jsonl")):
        rows = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
        out.append({"name": p.stem, "rows": rows})
    return out


@app.post("/api/verify-key")
def verify_key(request: Request):
    k = _key(request)
    try:
        r = JevClient(k, timeout=20).ask("ping", {"ok": {"type": "noul", "instructions": "Is this text the word ping?"}})
    except JevError as e:
        _track(request, "key_connected", ok=False)
        if e.status in (401, 403):
            raise HTTPException(401, _invalid(request))
        raise HTTPException(502, f"Jev could not be reached ({e.status}); try again")
    _track(request, "key_connected", ok=True)
    return {"ok": True, "model": r.model, "latency_ms": round(r.latency_ms, 1)}


def _row_inputs(r: dict) -> dict:
    return {k: r.get(k) for k in ("query", "response", "tool_definitions", "tool_calls", "context")}


async def _json_obj(request: Request) -> dict:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "Request body must be a JSON object; nothing was run")
    return body


def _metrics(body: dict) -> list[str]:
    """Metrics to judge. Omitted -> all (API default). An explicit value must be a non-empty list of exact
    metric IDs; empty, non-list, non-string or unknown/mistyped names are refused (400) before any Jev/baseline/
    Foundry call, so a request never silently runs a different set than asked (no typo repair)."""
    if "metrics" not in body or body.get("metrics") is None:
        return list(METRICS)
    req = body.get("metrics")
    allowed = ", ".join(METRICS)
    if not isinstance(req, list):
        raise HTTPException(400, f"'metrics' must be a list of metric IDs ({allowed}); nothing was run")
    if not req:
        raise HTTPException(400, "Select at least one metric; nothing was run")
    if not all(isinstance(x, str) for x in req):
        raise HTTPException(400, f"'metrics' must contain only strings (metric IDs: {allowed}); nothing was run")
    unknown = list(dict.fromkeys(x for x in req if x not in METRICS))
    if unknown:
        shown = ", ".join(repr(x if len(x) <= 64 else x[:64] + "…") for x in unknown[:10])
        more = f" (+{len(unknown) - 10} more)" if len(unknown) > 10 else ""
        raise HTTPException(400, f"Unknown metric ID(s): {shown}{more}. "
                                 f"Allowed: {allowed}; nothing was run")
    return [m for m in METRICS if m in req]  # exact IDs only; deduplicated, canonical order


@app.post("/api/judge")
async def judge(request: Request):
    k = _key(request)
    body = await _json_obj(request)
    rows = body.get("rows") or []
    if not isinstance(rows, list) or not rows:
        raise HTTPException(400, "No rows")
    if len(rows) > MAX_ROWS:
        raise HTTPException(400, f"Max {MAX_ROWS} rows per request (the UI batches automatically)")
    metrics = _metrics(body)
    want_bl = bool(body.get("baseline")) and baseline.configured()
    bl_note = None
    if want_bl and not _baseline_allow(len(rows)):
        want_bl, bl_note = False, "baseline hourly cap reached on this demo; Jev results unaffected"
    judge_ = JevAgentJudge(client=JevClient(k), metrics=metrics)

    def one(r):
        res = {"id": r.get("id"), "human": {m: r.get(f"human_{m}") for m in METRICS}}
        try:
            o = judge_(**_row_inputs(r))
            res["jev"] = {m: o.get(m) for m in metrics}
            res["jev_detail"] = {m: {"result": o.get(f"{m}_result"), "confidence": o.get(f"{m}_confidence"),
                                     "reason": o.get(f"{m}_reason"),
                                     "checks": (o.get(f"{m}_properties") or {}).get("checks")} for m in metrics}
            res["jev_meta"] = o["jev_properties"]
        except JevError as e:
            res["error"] = f"Jev error {e.status}"
            if e.status in (401, 403):
                raise
        if want_bl:
            def bl(m):
                try:
                    return m, baseline.run_metric(m, r)
                except Exception as e:  # keep Jev results even if baseline fails
                    return m, {"score": None, "error": type(e).__name__}
            res["llm"] = dict(_bl_pool.map(bl, metrics))
        return res

    try:
        futs = [_pool.submit(one, r) for r in rows]
        results = [f.result() for f in futs]
    except JevError as e:
        raise HTTPException(401, _invalid(request))
    return {"results": results, "baseline_note": bl_note, "version": VERSION}


@app.post("/api/foundry-run")
async def foundry(request: Request):
    """One azure.ai.evaluation.evaluate() run over the whole dataset, logged to the Foundry project."""
    k = _key(request)
    if not foundry_run.project_endpoint():
        raise HTTPException(400, "Foundry logging is not configured on this host")
    body = await _json_obj(request)
    rows = body.get("rows") or []
    if not isinstance(rows, list) or not rows:
        raise HTTPException(400, "No rows")
    if len(rows) > FOUNDRY_MAX_ROWS:
        raise HTTPException(400, f"Max {FOUNDRY_MAX_ROWS} rows per Foundry run")
    metrics = _metrics(body)
    want_bl = bool(body.get("baseline")) and baseline.configured()
    bl_note = None
    if want_bl and not _baseline_allow(len(rows)):
        want_bl, bl_note = False, "baseline hourly cap reached on this demo; Jev results unaffected"
    try:
        JevClient(k, timeout=20).ask("ping", {"ok": {"type": "noul", "instructions": "Is this text the word ping?"}})
    except JevError as e:
        raise HTTPException(401 if e.status in (401, 403) else 502,
                            _invalid(request) if e.status in (401, 403) else f"Jev could not be reached ({e.status})")
    if not _fnd_lock.acquire(timeout=120):
        raise HTTPException(429, "Another Foundry run is in progress on this instance; try again shortly")
    try:
        import asyncio
        out = await asyncio.get_running_loop().run_in_executor(
            _pool, lambda: foundry_run.run(rows, k, metrics, want_bl, body.get("name")))
    except Exception as e:  # never echo the key; surface the error type only
        raise HTTPException(502, f"Foundry evaluate() failed: {type(e).__name__}")
    finally:
        _fnd_lock.release()
    return {"results": foundry_run.to_app_results(out["rows"], rows, metrics), "baseline_note": bl_note,
            "studio_url": out["studio_url"], "version": VERSION}


@app.post("/api/summary")
async def summary(request: Request):
    body = await request.json()
    return summarize(body.get("results") or [], float(body.get("threshold", 3)))


@app.post("/api/generate")
async def gen(request: Request):
    body = await request.json()
    rows = body.get("rows") or []
    kinds = [k for k in (body.get("kinds") or MUTATIONS) if k in MUTATIONS]
    out = []
    for r in rows[:50]:
        out += generate(r, kinds)
    return {"rows": out}


@app.get("/healthz")
def health():
    return {"ok": True, "version": VERSION}


# ---------------------------------------------------------------- model router (t_38bc0c31)
ROUTER_EXEC_PER_HOUR = int(os.getenv("ROUTER_EXEC_PER_HOUR", "30"))
ROUTER_MAX_BATCH = 50
_rx_lock = threading.Lock()
_rx_window: list[float] = []
BENCH = ROOT / "static" / "router_bench"


def _models(body: dict) -> list[dict]:
    ms = body.get("models") or jrouter.DEFAULT_MODELS
    if not isinstance(ms, list) or not 2 <= len(ms) <= 8:
        raise HTTPException(400, "Give 2 to 8 model cards")
    out, seen = [], set()
    for i, m in enumerate(ms):
        if not isinstance(m, dict):
            raise HTTPException(400, "Each model card must be an object")
        key = str(m.get("key") or f"m{i}")[:32]
        name, desc = str(m.get("name") or "").strip()[:80], str(m.get("desc") or "").strip()[:1200]
        if not name or not desc:
            raise HTTPException(400, f"Model card {i + 1} needs a name and a capability description")
        if key in seen:
            raise HTTPException(400, "Model card keys must be unique")
        seen.add(key)
        try:
            pin, pout = float(m.get("in")), float(m.get("out"))
        except (TypeError, ValueError):
            raise HTTPException(400, f"Model card {i + 1} needs numeric prices")
        out.append({"key": key, "name": name, "desc": desc, "in": pin, "out": pout})
    return out


@app.get("/api/router/config")
def router_config():
    return {"models": jrouter.DEFAULT_MODELS, "exec_enabled": baseline.configured(),
            "exec_per_hour": ROUTER_EXEC_PER_HOUR, "max_batch": ROUTER_MAX_BATCH,
            "instructions": jrouter.INSTRUCTIONS, "price_source": "Azure retail prices API, Global Standard, eastus2 meters, read 2026-09-29"}


@app.post("/api/router/route")
async def router_route(request: Request):
    k = _key(request)
    body = await _json_obj(request)
    prompts = body.get("prompts")
    if not isinstance(prompts, list) or not prompts or not all(isinstance(p, str) and p.strip() for p in prompts):
        raise HTTPException(400, "Give one or more non-empty prompts")
    if len(prompts) > ROUTER_MAX_BATCH:
        raise HTTPException(400, f"Max {ROUTER_MAX_BATCH} prompts per request")
    models = _models(body)
    cl = JevClient(k)
    try:
        res = list(_pool.map(lambda p: jrouter.route(cl, p[:8000], models), prompts))
    except JevError as e:
        if e.status in (401, 403):
            raise HTTPException(401, _invalid(request))
        raise HTTPException(502, f"Jev error {e.status}")
    _track(request, "route_run", n=len(prompts))
    return {"results": res, "version": VERSION}


@app.post("/api/router/execute")
async def router_execute(request: Request):
    _key(request)  # same BYO gate as routing; the answer call itself is host-paid and capped
    if not baseline.configured():
        raise HTTPException(400, "Execution is not configured on this host")
    body = await _json_obj(request)
    key, prompt = body.get("model"), body.get("prompt")
    dep = {m["key"]: m["deployment"] for m in jrouter.DEFAULT_MODELS}.get(key)
    if not dep or not isinstance(prompt, str) or not prompt.strip():
        raise HTTPException(400, "Execution runs only on the three default TEAM deployments")
    with _rx_lock:
        now = time.time()
        while _rx_window and now - _rx_window[0] > 3600:
            _rx_window.pop(0)
        if len(_rx_window) >= ROUTER_EXEC_PER_HOUR:
            raise HTTPException(429, f"Demo cap reached ({ROUTER_EXEC_PER_HOUR} answers per hour); routing still works")
        _rx_window.append(now)
    import asyncio
    try:
        out = await asyncio.get_running_loop().run_in_executor(_pool, lambda: jrouter.execute(dep, prompt[:4000]))
    except Exception as e:
        raise HTTPException(502, f"Azure OpenAI call failed: {type(e).__name__}")
    _track(request, "answer_fetched")
    m = next(x for x in jrouter.DEFAULT_MODELS if x["key"] == key)
    out["usd"] = out["prompt_tokens"] * m["in"] / 1e6 + out["completion_tokens"] * m["out"] / 1e6
    out["deployment"], out["model"] = dep, m["name"]
    return out


@app.get("/api/router/benchmark")
def router_benchmark():
    p = BENCH / "results.json"
    if not p.exists():
        return {"available": False}
    return {"available": True, **json.loads(p.read_text())}


@app.get("/router")
def router_page():
    # the router is the home page now; keep old links working
    return RedirectResponse("/", status_code=308)


@app.get("/evaluate")
def evaluate_page():
    return FileResponse(ROOT / "static" / "index.html")


# ---------------------------------------------------------------- privacy-light analytics (t_8395031b)
@app.post("/api/t")
async def track(request: Request):
    """Browser-reported events: page_view, benchmark_opened, export, eval_run. Allow-listed props only."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    name = body.get("e") if isinstance(body, dict) else None
    if name in analytics.CLIENT_EVENTS or name == "eval_run":
        _track(request, name, **(body.get("p") if isinstance(body.get("p"), dict) else {}))
    return Response(status_code=204)


def _esc(x) -> str:
    import html
    return html.escape(str(x))


@app.get("/stats")
def stats_page(request: Request):
    if not analytics.check_password(request.headers.get("authorization")):
        return Response("Password required", 401, {"WWW-Authenticate": 'Basic realm="Jev stats", charset="UTF-8"'})
    try:
        evs, src = analytics.fetch_events()
        err = ""
    except Exception as e:
        evs, src, err = [], "unavailable", type(e).__name__
    s = analytics.summarize(evs)
    f = s["funnel"]
    mx = max([d["views"] for d in s["per_day"]] or [1]) or 1
    pct = lambda a, b: f"{(100 * a / b):.0f}%" if b else "–"
    rows = "".join(f"<tr><td>{_esc(d['day'])}</td><td class=n>{d['visitors']}</td><td class=n>{d['views']}</td>"
                   f"<td><span class=bar style='width:{max(2, round(100 * d['views'] / mx))}%'></span></td></tr>" for d in s["per_day"])
    refs = "".join(f"<tr><td>{_esc(h)}</td><td class=n>{c}</td></tr>" for h, c in s["referrers"]) or "<tr><td colspan=2>None yet</td></tr>"
    devs = "".join(f"<tr><td>{_esc(k)}</td><td class=n>{v}</td></tr>" for k, v in sorted(s["devices"].items())) or "<tr><td colspan=2>None yet</td></tr>"
    last = "".join("<tr><td data-l=Time>" + _esc(str(e.get("t", ""))[:19].replace("T", " ")) + "</td><td data-l=Event>" + _esc(e.get("name")) + "</td><td data-l=Details>"
                   + _esc(", ".join(f"{k}={v}" for k, v in e.items() if k not in ("t", "name"))) + "</td></tr>" for e in s["last"]) \
        or "<tr><td colspan=3>No events yet</td></tr>"
    note = f"<p class=err role=alert>Couldn't read analytics ({_esc(err)}).</p>" if err else ""
    body = f"""<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Usage stats · Jev</title><meta name=robots content=noindex><link rel=stylesheet href="/static/stats.css"></head><body><main>
<h1>Usage stats</h1><p class=sub>Counting since analytics went live on 29 Sep 2026. Days are UTC. Visitors are daily-rotating anonymous hashes, so a person returning on another day counts again. Source: {_esc(src)}.</p>{note}
<section aria-labelledby=f-h><h2 id=f-h>Funnel</h2><ol class=funnel>
<li><b>{f['visited']}</b> visited</li><li><b>{f['connected']}</b> connected a key <span>{pct(f['connected'], f['visited'])} of visitors</span></li>
<li><b>{f['ran']}</b> ran a route or evaluation <span>{pct(f['ran'], f['visited'])} of visitors</span></li></ol></section>
<section aria-labelledby=d-h><h2 id=d-h>Per day</h2><table><thead><tr><th scope=col>Day</th><th scope=col class=n>Visitors</th><th scope=col class=n>Page views</th><th scope=col class=bc><span class=sr>Chart</span></th></tr></thead><tbody>{rows or "<tr><td colspan=4>No visits yet</td></tr>"}</tbody></table></section>
<div class=two><section aria-labelledby=r-h><h2 id=r-h>Top referrers</h2><table><tbody>{refs}</tbody></table></section>
<section aria-labelledby=v-h><h2 id=v-h>Devices</h2><table><tbody>{devs}</tbody></table></section></div>
<section aria-labelledby=l-h><h2 id=l-h>Last 20 events</h2><table class=ev><thead><tr><th scope=col>Time (UTC)</th><th scope=col>Event</th><th scope=col>Details</th></tr></thead><tbody>{last}</tbody></table></section>
</main></body></html>"""
    return HTMLResponse(body)


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "router.html")
