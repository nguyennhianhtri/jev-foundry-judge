"""Privacy-light first-party usage analytics (t_8395031b).

* No cookies, no third-party scripts, no Jev keys, no prompt text, no raw IPs.
* Visitor id = HMAC(secret, UTC-date | ip | user-agent)[:16] -> rotates daily, unlinkable across days.
* Events go to the app's existing Application Insights (customEvents) via its ingestion endpoint;
  /stats reads them back with the app's managed identity. Without a connection string nothing is sent
  (local/dev); the in-process ring buffer only serves tests and the "last events" fallback.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import threading
import time
import urllib.request
from collections import Counter, deque
from datetime import datetime, timezone
from urllib.parse import urlparse

EVENTS = {"page_view", "key_connected", "route_run", "answer_fetched", "eval_run", "benchmark_opened", "export"}
CLIENT_EVENTS = {"page_view", "benchmark_opened", "export"}  # the rest are recorded server-side only
ROUTES = {"/", "/evaluate"}
PREFIX = "jev."  # customEvents name prefix
RING: deque = deque(maxlen=500)
_lock = threading.Lock()


def _secret() -> bytes:
    s = os.getenv("ANALYTICS_SALT") or ""
    if not s:  # dev fallback: per-process random, still never stores raw IPs
        global _DEV
        try:
            _DEV
        except NameError:
            _DEV = os.urandom(32)
        return _DEV
    return s.encode()


def client_ip(headers, peer: str | None) -> str:
    xff = headers.get("x-forwarded-for") or ""
    return (xff.split(",")[0].strip() or peer or "")


def visitor(ip: str, ua: str, day: str | None = None) -> str:
    day = day or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return hmac.new(_secret(), f"{day}|{ip}|{ua}".encode(), hashlib.sha256).hexdigest()[:16]


def device(ua: str) -> str:
    u = ua or ""
    if re.search(r"iPad|Tablet", u):
        return "tablet"
    if re.search(r"Mobi|iPhone|Android", u):
        return "phone"
    return "desktop"


def ref_host(ref: str | None) -> str:
    """Host only, never path/query. Same-site and empty -> '(direct)'."""
    try:
        h = (urlparse(str(ref or "")).hostname or "").lower()
    except ValueError:
        h = ""
    if not h or h.endswith("azurecontainerapps.io") or h in ("localhost", "127.0.0.1", "testserver"):
        return "(direct)"
    return h[:80]


def _clean_props(name: str, raw: dict) -> dict:
    """Allow-list per event. Anything else (prompt text, keys, free text) is dropped."""
    raw = raw if isinstance(raw, dict) else {}
    out: dict = {}
    if name == "page_view":
        r = raw.get("route")
        out["route"] = r if r in ROUTES else "/"
        out["ref"] = ref_host(raw.get("ref"))
    elif name == "key_connected":
        out["ok"] = bool(raw.get("ok"))
    elif name in ("route_run", "eval_run"):
        try:
            out["n"] = max(0, min(int(raw.get("n") or 0), 10000))
        except (TypeError, ValueError):
            out["n"] = 0
        if name == "eval_run":
            out["kind"] = raw.get("kind") if raw.get("kind") in ("judge", "foundry") else "judge"
    elif name == "export":
        k = str(raw.get("kind") or "")
        out["kind"] = re.sub(r"[^a-z0-9_-]", "", k.lower())[:40] or "other"
    elif name == "benchmark_opened":
        out["where"] = raw.get("where") if raw.get("where") in ("router", "evaluate") else "router"
    return out


def _conn():
    cs = os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING") or ""
    parts = dict(p.split("=", 1) for p in cs.split(";") if "=" in p)
    return parts.get("InstrumentationKey"), (parts.get("IngestionEndpoint") or "").rstrip("/")


def _send(env: dict) -> None:
    ikey, ep = _conn()
    if not ikey or not ep:
        return
    try:
        req = urllib.request.Request(ep + "/v2/track", json.dumps([env]).encode(), {"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:
        pass  # analytics must never break the app


def record(name: str, props: dict, ip: str, ua: str, sync: bool = False) -> dict | None:
    if name not in EVENTS:
        return None
    p = _clean_props(name, props)
    p["v"] = visitor(ip, ua)
    p["device"] = device(ua)
    ts = datetime.now(timezone.utc)
    ev = {"t": ts.isoformat(), "name": name, **p}
    with _lock:
        RING.append(ev)
    ikey, _ = _conn()
    if ikey:
        env = {"name": "Microsoft.ApplicationInsights.Event", "time": ts.strftime("%Y-%m-%dT%H:%M:%S.%fZ"), "iKey": ikey,
               "tags": {"ai.cloud.role": "jev-foundry-judge"},
               "data": {"baseType": "EventData", "baseData": {"ver": 2, "name": PREFIX + name,
                                                               "properties": {k: str(v) for k, v in p.items()}}}}
        if sync:
            _send(env)
        else:
            threading.Thread(target=_send, args=(env,), daemon=True).start()
    return ev


# ---------------------------------------------------------------- reading back
KQL = ("customEvents | where timestamp > ago(30d) and name startswith 'jev.' "
       "| project timestamp, name, customDimensions | order by timestamp asc | take 50000")


def _mi_token(scope: str) -> str:
    from azure.identity import DefaultAzureCredential
    global _CRED
    try:
        _CRED
    except NameError:
        _CRED = DefaultAzureCredential(managed_identity_client_id=os.getenv("AZURE_CLIENT_ID") or None)
    return _CRED.get_token(scope).token


def fetch_events() -> tuple[list[dict], str]:
    """Returns (events, source). Falls back to this instance's ring buffer when App Insights is not wired."""
    app_id = os.getenv("APPINSIGHTS_APP_ID")
    if not app_id:
        with _lock:
            return list(RING), "memory"
    tok = _mi_token("https://api.applicationinsights.io/.default")
    req = urllib.request.Request(f"https://api.applicationinsights.io/v1/apps/{app_id}/query",
                                 json.dumps({"query": KQL}).encode(),
                                 {"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        o = json.load(r)
    t = o["tables"][0]
    cols = [c["name"] for c in t["columns"]]
    out = []
    for row in t["rows"]:
        d = dict(zip(cols, row))
        cd = d.get("customDimensions") or {}
        if isinstance(cd, str):
            cd = json.loads(cd or "{}")
        out.append({"t": d["timestamp"], "name": d["name"][len(PREFIX):], **cd})
    return out, "appinsights"


def summarize(events: list[dict]) -> dict:
    days: dict[str, dict] = {}
    visited, connected, ran = set(), set(), set()
    refs, devs = Counter(), Counter()
    counts = Counter()
    for e in events:
        n, v, day = e.get("name"), e.get("v") or "?", str(e.get("t", ""))[:10]
        counts[n] += 1
        d = days.setdefault(day, {"day": day, "visitors": set(), "views": 0})
        d["visitors"].add(v)
        key = (day, v)  # visitor ids only mean something within a UTC day
        if n == "page_view":
            d["views"] += 1
            visited.add(key)
            refs[e.get("ref") or "(direct)"] += 1
            devs[e.get("device") or "desktop"] += 1
        elif n == "key_connected" and str(e.get("ok")).lower() == "true":
            connected.add(key)
        elif n in ("route_run", "eval_run"):
            ran.add(key)
    per_day = [{"day": k, "visitors": len(x["visitors"]), "views": x["views"]} for k, x in sorted(days.items())]
    last = [{k: e.get(k) for k in ("t", "name", "route", "ref", "device", "ok", "n", "kind", "where") if e.get(k) not in (None, "")}
            for e in events[-20:]][::-1]
    return {"per_day": per_day, "funnel": {"visited": len(visited), "connected": len(connected & visited) if visited else len(connected),
                                           "ran": len(ran)},
            "referrers": refs.most_common(10), "devices": dict(devs), "counts": dict(counts),
            "total_visitors": len(visited), "total_views": sum(x["views"] for x in per_day), "last": last}


# ---------------------------------------------------------------- /stats password (HTTP Basic, no cookie)
def check_password(auth_header: str | None) -> bool:
    """STATS_PASSWORD_HASH = 'pbkdf2$<iters>$<b64 salt>$<b64 dk>'. Username is ignored."""
    spec = os.getenv("STATS_PASSWORD_HASH") or ""
    if not spec or not auth_header or not auth_header.lower().startswith("basic "):
        return False
    try:
        _, it, salt, dk = spec.split("$")
        user_pw = base64.b64decode(auth_header.split(" ", 1)[1]).decode("utf-8", "replace")
        pw = user_pw.split(":", 1)[1] if ":" in user_pw else user_pw
        got = hashlib.pbkdf2_hmac("sha256", pw.encode(), base64.b64decode(salt), int(it))
        return hmac.compare_digest(got, base64.b64decode(dk))
    except Exception:
        return False


def make_hash(pw: str, iters: int = 200_000) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, iters)
    return f"pbkdf2${iters}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"
