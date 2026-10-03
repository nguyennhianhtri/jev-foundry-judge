"""Run the frozen router benchmark live (t_38bc0c31). Jev Choice vs LLM router vs embedding similarity vs always-strong.
All routers see the SAME three default model cards (zero-shot; no training on this set). Run from Singapore."""
import hashlib, json, math, os, subprocess, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, "../../src")
from jev_foundry_judge import router as jr
from jev_foundry_judge.jev_client import JevClient
D = open("dataset.jsonl").read(); assert hashlib.sha256(D.encode()).hexdigest() == json.load(open("labels.lock"))["sha256"]
DS = [json.loads(l) for l in D.splitlines()]
M = jr.DEFAULT_MODELS; KEYS = [m["key"] for m in M]
EP = os.environ["AOAI_ENDPOINT"].rstrip("/") + "/openai/deployments"
_tok = {"t": None, "at": 0}
def tok():
    if time.time() - _tok["at"] > 1800:
        _tok["t"] = subprocess.check_output(["az", "account", "get-access-token", "--resource", "https://cognitiveservices.azure.com", "--query", "accessToken", "-o", "tsv"]).decode().strip(); _tok["at"] = time.time()
    return _tok["t"]
def aoai(dep, path, body):
    for a in range(5):
        try:
            req = urllib.request.Request(f"{EP}/{dep}/{path}?api-version=2025-04-01-preview", json.dumps(body).encode(), {"Authorization": "Bearer " + tok(), "Content-Type": "application/json"})
            t0 = time.perf_counter(); o = json.load(urllib.request.urlopen(req, timeout=120)); return o, (time.perf_counter() - t0) * 1000
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503): raise
            time.sleep(2 ** a)
    raise RuntimeError("aoai retries")
out = {}
# --- Jev
jc = JevClient([l.split("=", 1)[1].strip().strip('"') for l in open("../../.env") if l.startswith("JEV_API_KEY")][0])
def jev(r):
    x = jr.route(jc, r["prompt"], M); return {"pred": x["choice"], "probs": x["probabilities"], "conf": x["confidence"], "ms": x["latency_ms"], "usd": x["usd"], "in": x["input_tokens"]}
# --- LLM router (gpt-5.4-mini, same cards, JSON probabilities)
SYS = (jr.INSTRUCTIONS + "\nModels:\n" + "\n".join(f"- {m['key']}: {m['name']}: {m['desc']}" for m in M) +
       '\nReply with JSON only: {"route": "<small|strong|code>", "probabilities": {"small": p, "strong": p, "code": p}} with probabilities summing to 1.')
def llm(r):
    o, ms = aoai("judge-gpt-5-4-mini", "chat/completions", {"messages": [{"role": "system", "content": SYS}, {"role": "user", "content": "User prompt to route:\n<<<\n" + r["prompt"] + "\n>>>"}],
                                                           "max_completion_tokens": 400, "reasoning_effort": "low", "response_format": {"type": "json_object"}})
    u = o["usage"]; usd = u["prompt_tokens"] * 0.75 / 1e6 + u["completion_tokens"] * 4.5 / 1e6
    try:
        j = json.loads(o["choices"][0]["message"]["content"]); p = {k: float(j.get("probabilities", {}).get(k, 0)) for k in KEYS}; s = sum(p.values()) or 1; p = {k: v / s for k, v in p.items()}
        pred = j.get("route") if j.get("route") in KEYS else max(p, key=p.get)
    except Exception:
        p, pred = None, "strong"
    return {"pred": pred, "probs": p, "conf": max(p.values()) if p else None, "ms": ms, "usd": usd, "in": u["prompt_tokens"], "out": u["completion_tokens"]}
# --- embedding similarity (text-embedding-3-small, prompt vs card text, softmax T=0.05)
card_vecs = None
def emb(texts): o, ms = aoai("router-embed-3-small", "embeddings", {"input": texts}); return [d["embedding"] for d in o["data"]], ms, o["usage"]["prompt_tokens"]
def cos(a, b): return sum(x * y for x, y in zip(a, b)) / math.sqrt(sum(x * x for x in a) * sum(y * y for y in b))
def embr(r):
    [v], ms, t = emb([r["prompt"][:8000]]); s = {m["key"]: cos(v, cv) for m, cv in zip(M, card_vecs)}
    e = {k: math.exp(x / 0.05) for k, x in s.items()}; z = sum(e.values()); p = {k: x / z for k, x in e.items()}
    return {"pred": max(p, key=p.get), "probs": p, "conf": max(p.values()), "ms": ms, "usd": t * 0.02 / 1e6, "in": t}
if __name__ == "__main__":
    card_vecs, _, _ = emb([f"{m['name']}: {m['desc']}" for m in M])
    for name, fn, par in [("jev", jev, 8), ("llm", llm, 8), ("embed", embr, 8)]:
        t0 = time.time()
        with ThreadPoolExecutor(par) as ex: res = list(ex.map(fn, DS))
        out[name] = res; print(name, "done", round(time.time() - t0), "s", flush=True)
    json.dump({"run_at": time.strftime("%Y-%m-%d %H:%M:%S %Z"), "raw": out}, open("raw.json", "w"))
