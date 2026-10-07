"""White-label model gateway control plane.

APIM is the data plane: it authenticates the API key (an APIM subscription), applies circuit breakers and
backend pools, forwards to the model and stamps the routing headers. Before forwarding it asks this module
(`decide`) which backend to use; after the reply it reports usage (`meter`).

State:
  * Gateway config (per-key allow-list, limits, credits, routing policy) is one JSON document. In Azure it is the
    APIM named value `gw-config` (read/written over ARM with the app's managed identity); locally it is a file.
  * Usage events go to Application Insights (customEvents `gw.call`) and an in-memory ring.
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from datetime import datetime, timezone

from . import router as jrouter
from .jev_client import JevClient

# Azure retail list prices, USD per 1M tokens (prices.azure.com, eastus2 meters, read 2026-10-05).
# DeepSeek-V4-Flash: only a Data Zone meter is published; the Global Standard deployment is billed on its own meter.
CATALOGUE = [
    {"id": "gpt-5.4-nano", "provider": "Azure OpenAI", "family": "OpenAI", "pool": "nano", "in": 0.20, "out": 1.25,
     "region": "Global processing · stored in Southeast Asia", "residency": "global", "kind": "chat",
     "desc": "Small, fast, cheap. Good for greetings and chit-chat, simple factual lookups, short rewrites, "
             "summaries, translation and classification. Weak at multi-step reasoning and non-trivial code."},
    {"id": "gpt-5.4-mini", "provider": "Azure OpenAI", "family": "OpenAI", "pool": "mini", "in": 0.75, "out": 4.50,
     "region": "Global processing · stored in Southeast Asia", "residency": "global", "kind": "chat",
     "desc": "Mid-size general model. Good for longer drafting, structured extraction, customer-service answers "
             "and explanations that need some care but no deep multi-step reasoning."},
    {"id": "deepseek-v4-flash", "provider": "Microsoft Foundry", "family": "DeepSeek (open weights)", "pool": "deepseek",
     "in": 0.15, "out": 0.31, "region": "Global processing · stored in East US 2", "residency": "global", "kind": "chat",
     "desc": "Open-weight model, very cheap. Good at writing, completing, fixing and explaining source code, "
             "and at step-by-step arithmetic and short maths word problems."},
    {"id": "gpt-5.4", "provider": "Azure OpenAI", "family": "OpenAI", "pool": "strong", "in": 2.50, "out": 15.00,
     "region": "Global processing · stored in Southeast Asia", "residency": "global", "kind": "chat",
     "desc": "Strongest general reasoning model. Use for multi-step maths and logic, expert-level science, law or "
             "medicine questions, careful analysis, planning and anything high-stakes."},
]
DECISION_MODELS = [
    {"id": "jev", "provider": "TypeSafe Jev API", "family": "Decision model", "in": 0.042, "out": 0.0,
     "region": "Vendor API", "residency": "vendor", "kind": "router"},
    {"id": "clef-flash", "provider": "Self-hosted (your VM)", "family": "Open-weight decision model", "in": None,
     "out": None, "region": "Your tenant · Southeast Asia or any region", "residency": "tenant", "kind": "router"},
]
# Any OpenAI-compatible endpoint (vLLM/llama.cpp VM, another cloud) joins the catalogue via env, served by the
# APIM backend pool `gw-pool-compat` (deploy-gateway.sh with OPENAI_COMPAT_URL).
if os.getenv("GW_COMPAT_MODEL"):
    try:
        _c = json.loads(os.environ["GW_COMPAT_MODEL"])
        CATALOGUE.append({"provider": "OpenAI-compatible endpoint", "family": "Bring your own", "region": "Your choice",
                          "residency": "tenant", "kind": "chat", "in": 0.0, "out": 0.0,
                          "desc": "Self-hosted model on an OpenAI-compatible server.", **_c, "pool": "compat"})
    except (ValueError, TypeError):
        pass
BY_ID = {m["id"]: m for m in CATALOGUE}

DEFAULT_CONFIG = {
    "policy": {"classifier": "jev", "min_confidence": 0.6, "cheapest_p": 0.3, "fallback": "gpt-5.4",
               "budget_guard_pct": 80},
    "default_key": {"models": "*", "cpm": 30, "credits_usd": 5.0},
    "keys": {},
}


# ---------------------------------------------------------------- config store
class Store:
    """APIM named value when GW_APIM_ID is set (ARM, managed identity), else a local JSON file."""

    def __init__(self):
        self.apim = os.getenv("GW_APIM_ID", "").rstrip("/")
        self.path = os.getenv("GW_CONFIG_FILE", "/tmp/gw-config.json")
        self._cache: dict | None = None
        self._at = 0.0
        self._lock = threading.Lock()

    def get(self, fresh: bool = False) -> dict:
        with self._lock:
            if self._cache is not None and not fresh and time.time() - self._at < 20:
                return json.loads(json.dumps(self._cache))
        raw = None
        try:
            if self.apim:
                o = arm("GET", f"{self.apim}/namedValues/gw-config")
                raw = o["properties"].get("value")
            elif os.path.exists(self.path):
                raw = open(self.path).read()
        except Exception:
            raw = None
        cfg = normalize(json.loads(raw) if raw else {})
        with self._lock:
            self._cache, self._at = cfg, time.time()
        return json.loads(json.dumps(cfg))

    def put(self, cfg: dict) -> dict:
        cfg = normalize(cfg)
        s = json.dumps(cfg, separators=(",", ":"))
        if len(s) > 4000:
            raise ValueError("Config is too large for one APIM named value; remove unused keys")
        if self.apim:
            arm("PUT", f"{self.apim}/namedValues/gw-config",
                {"properties": {"displayName": "gw-config", "value": s, "secret": False}})
        else:
            open(self.path, "w").write(s)
        with self._lock:
            self._cache, self._at = cfg, time.time()
        return cfg


def normalize(c: dict) -> dict:
    out = json.loads(json.dumps(DEFAULT_CONFIG))
    p = c.get("policy") or {}
    pol = out["policy"]
    if p.get("classifier") in ("jev", "selfhost"):
        pol["classifier"] = p["classifier"]
    for k, lo, hi in (("min_confidence", 0, 1), ("cheapest_p", 0, 1), ("budget_guard_pct", 0, 100)):
        v = p.get(k)
        if isinstance(v, (int, float)) and lo <= v <= hi:
            pol[k] = float(v) if k != "budget_guard_pct" else int(v)
    if p.get("fallback") in BY_ID:
        pol["fallback"] = p["fallback"]
    if isinstance(c.get("default_key"), dict):
        out["default_key"] = _key_entry(c["default_key"], out["default_key"])
    for sid, e in (c.get("keys") or {}).items():
        if isinstance(e, dict) and isinstance(sid, str) and sid.replace("-", "").isalnum():
            out["keys"][sid[:40]] = _key_entry(e, out["default_key"], name=str(e.get("name") or sid)[:40])
    return out


def _key_entry(e: dict, d: dict, name: str | None = None) -> dict:
    models = e.get("models", d.get("models", "*"))
    if models != "*":
        models = [m for m in (models or []) if m in BY_ID] or [CATALOGUE[0]["id"]]
    num = lambda k, lo, hi: e[k] if isinstance(e.get(k), (int, float)) and lo <= e[k] <= hi else d[k]
    r = {"models": models, "cpm": int(num("cpm", 1, 10000)), "credits_usd": float(num("credits_usd", 0, 1e6))}
    if name is not None:
        r["name"] = name
        r["created"] = str(e.get("created") or datetime.now(timezone.utc).isoformat()[:19])
    return r


STORE = Store()


# ---------------------------------------------------------------- ARM (managed identity)
def _token(scope: str) -> str:
    from azure.identity import DefaultAzureCredential
    global _CRED
    try:
        _CRED
    except NameError:
        _CRED = DefaultAzureCredential(managed_identity_client_id=os.getenv("AZURE_CLIENT_ID") or None)
    return _CRED.get_token(scope).token


def arm(method: str, path: str, body: dict | None = None, api: str = "2024-06-01-preview") -> dict:
    url = f"https://management.azure.com{path}{'&' if '?' in path else '?'}api-version={api}"
    req = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": "Bearer " + _token("https://management.azure.com/.default"),
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        t = r.read()
    return json.loads(t) if t else {}


# ---------------------------------------------------------------- keys (APIM subscriptions)
def create_key(name: str, models, cpm: int, credits: float) -> dict:
    import secrets
    sid = "gwk-" + secrets.token_hex(4)
    if STORE.apim:
        arm("PUT", f"{STORE.apim}/subscriptions/{sid}",
            {"properties": {"scope": "/apis/gateway", "displayName": name[:40], "state": "active"}})
        key = arm("POST", f"{STORE.apim}/subscriptions/{sid}/listSecrets")["primaryKey"]
    else:
        key = "local-" + secrets.token_hex(16)
    cfg = STORE.get(fresh=True)
    cfg["keys"][sid] = {"name": name, "models": models, "cpm": cpm, "credits_usd": credits}
    STORE.put(cfg)
    return {"id": sid, "key": key}


def delete_key(sid: str) -> None:
    if STORE.apim:
        try:
            arm("DELETE", f"{STORE.apim}/subscriptions/{sid}")
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
    cfg = STORE.get(fresh=True)
    cfg["keys"].pop(sid, None)
    STORE.put(cfg)


_pg_key: tuple[str, float] | None = None


def playground_key() -> str | None:
    """Key of the built-in `playground` subscription (read with the app identity; never sent to the browser)."""
    global _pg_key
    if os.getenv("GW_PLAYGROUND_KEY"):
        return os.environ["GW_PLAYGROUND_KEY"]
    if not STORE.apim:
        return None
    if _pg_key and time.time() - _pg_key[1] < 600:
        return _pg_key[0]
    k = arm("POST", f"{STORE.apim}/subscriptions/playground/listSecrets")["primaryKey"]
    _pg_key = (k, time.time())
    return k


# ---------------------------------------------------------------- metering
_ring: deque = deque(maxlen=5000)
_ring_lock = threading.Lock()
_spend_base: dict = {"at": 0.0, "by": {}, "src": "memory"}
_rate: dict = defaultdict(deque)


def cost_usd(model: str, tin: int, tout: int) -> float:
    m = BY_ID.get(model)
    if not m:
        return 0.0
    return (tin * m["in"] + tout * m["out"]) / 1e6


def meter(ev: dict) -> dict:
    model = str(ev.get("model") or "")
    tin, tout = int(ev.get("prompt_tokens") or 0), int(ev.get("completion_tokens") or 0)
    rec = {"t": datetime.now(timezone.utc).isoformat(), "sub": str(ev.get("sub") or "")[:60], "model": model,
           "requested": str(ev.get("requested") or "")[:40], "reason": str(ev.get("reason") or "")[:120],
           "status": int(ev.get("status") or 0), "tin": tin, "tout": tout,
           "usd": round(cost_usd(model, tin, tout), 8), "ms": int(ev.get("ms") or 0)}
    with _ring_lock:
        _ring.append(rec)
    _send_ai(rec)
    return rec


def _send_ai(rec: dict) -> None:
    cs = os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING") or ""
    parts = dict(p.split("=", 1) for p in cs.split(";") if "=" in p)
    ikey, ep = parts.get("InstrumentationKey"), (parts.get("IngestionEndpoint") or "").rstrip("/")
    if not ikey or not ep:
        return
    env = {"name": "Microsoft.ApplicationInsights.Event", "time": rec["t"].replace("+00:00", "Z"), "iKey": ikey,
           "tags": {"ai.cloud.role": "model-gateway"},
           "data": {"baseType": "EventData", "baseData": {"ver": 2, "name": "gw.call",
                                                         "properties": {k: str(v) for k, v in rec.items()}}}}

    def go():
        try:
            urllib.request.urlopen(urllib.request.Request(ep + "/v2/track", json.dumps([env]).encode(),
                                                          {"Content-Type": "application/json"}), timeout=5).read()
        except Exception:
            pass
    threading.Thread(target=go, daemon=True).start()


KQL = ("customEvents | where timestamp > ago(30d) and name == 'gw.call' | extend d = customDimensions "
       "| project t = timestamp, sub = tostring(d.sub), model = tostring(d.model), requested = tostring(d.requested), "
       "reason = tostring(d.reason), status = toint(d.status), tin = toint(d.tin), tout = toint(d.tout), "
       "usd = todouble(d.usd), ms = toint(d.ms) | order by t desc | take 5000")


def events() -> tuple[list[dict], str]:
    """Durable events from App Insights when wired (ingestion lag ~1-3 min) merged with this instance's ring."""
    with _ring_lock:
        mem = list(_ring)
    app_id = os.getenv("APPINSIGHTS_APP_ID")
    if not app_id:
        return sorted(mem, key=lambda e: e["t"], reverse=True), "memory"
    try:
        req = urllib.request.Request(f"https://api.applicationinsights.io/v1/apps/{app_id}/query",
                                     json.dumps({"query": KQL}).encode(),
                                     {"Authorization": "Bearer " + _token("https://api.applicationinsights.io/.default"),
                                      "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            t = json.load(r)["tables"][0]
        cols = [c["name"] for c in t["columns"]]
        dur = [dict(zip(cols, row)) for row in t["rows"]]
    except Exception:
        return sorted(mem, key=lambda e: e["t"], reverse=True), "memory"
    # merge: in-memory events newer than the newest durable one are not ingested yet
    newest = max((str(e["t"]) for e in dur), default="")
    out = dur + [e for e in mem if e["t"] > newest[:26]]
    return sorted(out, key=lambda e: str(e["t"]), reverse=True), "appinsights+memory"


def spend_by_sub(max_age: float = 60) -> dict:
    if time.time() - _spend_base["at"] > max_age:
        evs, src = events()
        by: dict = defaultdict(float)
        for e in evs:
            by[e.get("sub") or ""] += float(e.get("usd") or 0)
        _spend_base.update(at=time.time(), by=dict(by), src=src, n=len(evs))
    return _spend_base["by"]


def _note_spend(sub: str, usd: float) -> None:
    _spend_base["by"][sub] = _spend_base["by"].get(sub, 0.0) + usd


def usage() -> dict:
    evs, src = events()
    cfg = STORE.get()
    per: dict = {}
    by_model: dict = defaultdict(lambda: {"calls": 0, "usd": 0.0, "tokens": 0})
    for e in evs:
        s = per.setdefault(e.get("sub") or "", {"calls": 0, "usd": 0.0, "tin": 0, "tout": 0, "errors": 0})
        s["calls"] += 1
        s["usd"] += float(e.get("usd") or 0)
        s["tin"] += int(e.get("tin") or 0)
        s["tout"] += int(e.get("tout") or 0)
        s["errors"] += 1 if int(e.get("status") or 0) >= 400 else 0
        bm = by_model[e.get("model") or "(rejected)"]
        bm["calls"] += 1
        bm["usd"] += float(e.get("usd") or 0)
        bm["tokens"] += int(e.get("tin") or 0) + int(e.get("tout") or 0)
    keys = []
    for sid in sorted(set(per) | set(cfg["keys"]) | {"playground"}):
        e = cfg["keys"].get(sid) or {**cfg["default_key"], "name": sid}
        u = per.get(sid, {"calls": 0, "usd": 0.0, "tin": 0, "tout": 0, "errors": 0})
        keys.append({"id": sid, "name": e.get("name", sid), "credits_usd": e["credits_usd"], **u,
                     "balance_usd": round(e["credits_usd"] - u["usd"], 6)})
    _spend_base.update(at=time.time(), by={k["id"]: k["usd"] for k in keys}, src=src)
    return {"source": src, "keys": keys, "by_model": dict(by_model), "recent": evs[:25],
            "total_usd": sum(k["usd"] for k in keys), "calls": len(evs)}


# ---------------------------------------------------------------- routing decision
class Reject(Exception):
    def __init__(self, status: int, code: str, msg: str):
        super().__init__(msg)
        self.status, self.code, self.msg = status, code, msg


def _rate_ok(sub: str, cpm: int) -> bool:
    q, now = _rate[sub], time.time()
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= cpm:
        return False
    q.append(now)
    return True


def _classifier(cfg: dict, jev_key: str | None) -> JevClient | None:
    if cfg["policy"]["classifier"] == "selfhost":
        url = os.getenv("SELFHOST_URL")
        if not url:
            return None
        return JevClient(os.getenv("SELFHOST_API_KEY") or "none", model=os.getenv("SELFHOST_MODEL", "clef-flash"),
                         url=url.rstrip("/") + "/v1/systemone", timeout=float(os.getenv("SELFHOST_TIMEOUT", "8")))
    return JevClient(jev_key, timeout=8) if jev_key else None


def decide(sub: str, requested: str, prompt: str, jev_key: str | None = None, route_fn=None) -> dict:
    cfg = STORE.get()
    pol = cfg["policy"]
    entry = cfg["keys"].get(sub) or cfg["default_key"]
    allowed = [m["id"] for m in CATALOGUE] if entry["models"] == "*" else list(entry["models"])
    requested = (requested or "auto").strip()
    if requested not in ("auto", *BY_ID):
        raise Reject(404, "model_not_found", f"Unknown model '{requested[:40]}'. Use auto or one of: {', '.join(BY_ID)}.")
    if requested != "auto" and requested not in allowed:
        raise Reject(403, "model_not_allowed", f"This API key may not use '{requested}'. Allowed: {', '.join(allowed)}.")
    if not _rate_ok(sub, entry["cpm"]):
        raise Reject(429, "rate_limited", f"Rate limit: {entry['cpm']} requests per minute for this key.")
    spent = spend_by_sub().get(sub, 0.0)
    credits = entry["credits_usd"]
    if spent >= credits:
        raise Reject(402, "credits_exhausted", "Prepaid credits are used up for this key. Top up in Admin.")
    guard = credits > 0 and spent >= credits * pol["budget_guard_pct"] / 100

    conf, probs, cls_ms = None, {}, None
    if requested != "auto":
        pick, reason = requested, "pinned by caller"
    elif guard:
        pick = min(allowed, key=lambda m: BY_ID[m]["in"] + BY_ID[m]["out"])
        reason = f"budget guard: {spent / credits:.0%} of credits used, cheapest allowed model"
    else:
        cards = [{"key": m, "name": m, "desc": BY_ID[m]["desc"], "in": BY_ID[m]["in"], "out": BY_ID[m]["out"]}
                 for m in allowed]
        fb = pol["fallback"] if pol["fallback"] in allowed else max(allowed, key=lambda m: BY_ID[m]["out"])
        if len(cards) == 1:
            pick, reason = cards[0]["key"], "only allowed model"
        else:
            try:
                if route_fn:
                    r = route_fn(prompt, cards)
                else:
                    cl = _classifier(cfg, jev_key)
                    if cl is None:
                        raise RuntimeError("classifier not configured")
                    r = jrouter.route(cl, prompt[:8000], cards)
                probs, conf, cls_ms = r["probabilities"], r["confidence"], r.get("latency_ms")
                tin = max(1, len(prompt) // 4)
                d = jrouter.apply_policy(probs, conf, cards, fb, pol["min_confidence"], pol["cheapest_p"], tin, 400)
                pick, reason = d["routed"], d["why"].replace("strong", fb)
            except Exception as e:
                pick, reason = fb, f"classifier unavailable ({type(e).__name__}); fell back to {fb}"
    m = BY_ID[pick]
    reason = reason.replace("≥", ">=").encode("ascii", "replace").decode()
    return {"allow": True, "model": pick, "pool": m["pool"], "reason": reason,
            "confidence": "" if conf is None else f"{conf:.3f}", "pin": m["in"], "pout": m["out"],
            "classifier": pol["classifier"] if requested == "auto" else "none", "classifier_ms": cls_ms,
            "probabilities": {k: round(v, 4) for k, v in probs.items()}}


def selfhost_status() -> str:
    url = os.getenv("SELFHOST_URL")
    if not url:
        return "not configured (VM deallocated)"
    try:
        with urllib.request.urlopen(url.rstrip("/") + "/health", timeout=1.5) as r:
            return "available" if r.status == 200 else "unavailable"
    except Exception:
        return "offline (VM deallocated)"


def catalogue() -> list[dict]:
    with _ring_lock:
        last = {}
        for e in _ring:
            last[e["model"]] = e["status"]
    out = []
    for m in CATALOGUE:
        st = last.get(m["id"])
        out.append({**{k: v for k, v in m.items() if k != "desc"}, "summary": m["desc"].split(". ")[0] + ".",
                    "status": "degraded" if st and st >= 500 else "available"})
    for m in DECISION_MODELS:
        st = "available" if m["id"] == "jev" else selfhost_status()
        out.append({**m, "pool": None, "status": st,
                    "summary": "Picks the model for each prompt (model: auto)." if m["id"] == "jev" else
                    "Open-weight router you run in your own tenant; same API as Jev."})
    return out


def finite(x) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x)
