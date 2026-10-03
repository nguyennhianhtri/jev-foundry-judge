"""t_a12a1f0b: 60-prompt stratified subset of the frozen 240-prompt router benchmark (repo commit 92e5627, labels.lock verified).
Per prompt: (1) direct router /api/router/route, (2) APIM auto, (3) APIM pinned to the class APIM chose,
(4) Foundry model-router deployment direct. Answers capped at 32 output tokens (latency/routing test, not quality).
Secrets: APIM key read from a 0600 temp file, Jev key from repo .env; never printed or written."""
import hashlib, json, os, subprocess, sys, time, urllib.request, urllib.error
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

R = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "router")
D = open(f"{R}/dataset.jsonl").read()
assert hashlib.sha256(D.encode()).hexdigest() == json.load(open(f"{R}/labels.lock"))["sha256"]
DS = [json.loads(l) for l in D.splitlines()]
# stratified: 20 per label, proportional per source, deterministic by sha(id)
# largest-remainder per source within each label (sources are label-pure), deterministic order by sha256(id)
by = defaultdict(list)
for r in DS: by[r["source"]].append(r)
SUB = []
for lab in ("small", "strong", "code"):
    srcs = {s: rows for s, rows in by.items() if rows[0]["label"] == lab}
    q = {s: len(rows) * 20 / 80 for s, rows in srcs.items()}; n = {s: int(v) for s, v in q.items()}
    for s in sorted(q, key=lambda s: -(q[s] - n[s]))[:20 - sum(n.values())]: n[s] += 1
    for s, rows in srcs.items(): SUB += sorted(rows, key=lambda r: hashlib.sha256(r["id"].encode()).hexdigest())[:n[s]]
assert len(SUB) == 60 and Counter(r["label"] for r in SUB) == {"small": 20, "strong": 20, "code": 20}, Counter(r["label"] for r in SUB)

APP = os.environ["APP_URL"]
GW = os.environ["APIM_GATEWAY"].rstrip("/") + "/openai/deployments"
AO = os.environ["AOAI_ENDPOINT"].rstrip("/") + "/openai/deployments"
APIMK = os.environ["APIM_KEY"]
JEVK = os.environ["JEV_API_KEY"]
TOK = subprocess.check_output(["az", "account", "get-access-token", "--resource", "https://cognitiveservices.azure.com", "--query", "accessToken", "-o", "tsv"], env={**os.environ, "AZURE_CONFIG_DIR": os.path.expanduser("~/.azure")}).decode().strip()

def post(url, body, hdr, tries=4):
    for a in range(tries):
        req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json", **hdr})
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, dict(r.headers), json.load(r), (time.perf_counter() - t0) * 1000
        except urllib.error.HTTPError as e:
            ms = (time.perf_counter() - t0) * 1000
            if e.code in (429, 500, 502, 503) and a < tries - 1: time.sleep(2 ** a + 1); continue
            return e.code, dict(e.headers), {"error": e.read()[:300].decode(errors="replace")}, ms

def msg(p): return {"messages": [{"role": "user", "content": p[:8000]}], "max_completion_tokens": 32}

def one(r):
    o = {"id": r["id"], "label": r["label"], "source": r["source"]}
    s, _, b, ms = post(f"{APP}/api/router/route", {"prompts": [r["prompt"][:8000]]}, {"x-jev-key": JEVK})
    x = b["results"][0] if s == 200 else {}
    o["direct"] = {"status": s, "ms": ms, "choice": x.get("choice"), "conf": x.get("confidence")}
    s, h, b, ms = post(f"{GW}/auto/chat/completions?api-version=2025-04-01-preview", msg(r["prompt"]), {"api-key": APIMK})
    h = {k.lower(): v for k, v in h.items()}
    o["apim_auto"] = {"status": s, "ms": ms, "route": h.get("x-routed-model"), "source": h.get("x-route-source"), "conf": h.get("x-route-confidence"), "usage": b.get("usage"), "err": b.get("error") if s != 200 else None}
    rt = h.get("x-routed-model") or "strong"
    s, h, b, ms = post(f"{GW}/{rt}/chat/completions?api-version=2025-04-01-preview", msg(r["prompt"]), {"api-key": APIMK})
    o["apim_pinned"] = {"status": s, "ms": ms, "class": rt}
    s, h, b, ms = post(f"{AO}/model-router/chat/completions?api-version=2025-04-01-preview", msg(r["prompt"]), {"Authorization": "Bearer " + TOK})
    o["foundry_mr"] = {"status": s, "ms": ms, "model": b.get("model"), "usage": b.get("usage"), "err": b.get("error") if s != 200 else None}
    return o

if __name__ == "__main__":
    t0 = time.time()
    with ThreadPoolExecutor(4) as ex: res = list(ex.map(one, SUB))
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "apim-bench-raw.json")
    json.dump({"run_at": time.strftime("%Y-%m-%d %H:%M:%S %Z"), "commit": "92e5627", "n": len(res), "rows": res}, open(out, "w"), indent=1)
    print("done", round(time.time() - t0), "s ->", out)
