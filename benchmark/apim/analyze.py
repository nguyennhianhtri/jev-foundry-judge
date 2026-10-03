import json, statistics as st
from collections import Counter
d = json.load(open(__import__("os").path.join(__import__("os").path.dirname(__file__), "apim-bench-raw.json"))); R = d["rows"]
def pct(v, p): v = sorted(v); k = (len(v)-1)*p; f = int(k); return v[f] + (v[min(f+1, len(v)-1)]-v[f])*(k-f)
ok = lambda r, k: r[k]["status"] == 200
print("statuses", {k: Counter(r[k]["status"] for r in R) for k in ("direct","apim_auto","apim_pinned","foundry_mr")})
dc = Counter(r["direct"]["choice"] for r in R); ac = Counter(r["apim_auto"]["route"] for r in R)
print("direct dist", dict(dc), "apim dist", dict(ac)); print("route-source", dict(Counter(r["apim_auto"]["source"] for r in R)))
agree = sum(1 for r in R if r["apim_auto"]["source"]=="router" and r["apim_auto"]["route"]==r["direct"]["choice"]); nr = sum(1 for r in R if r["apim_auto"]["source"]=="router")
print("agree(router-sourced)", agree, "/", nr)
dfb = [("strong" if (r["direct"]["conf"] or 0) < 0.6 else r["direct"]["choice"]) for r in R]
print("acc direct raw", sum(r["direct"]["choice"]==r["label"] for r in R), "direct+fallback", sum(c==r["label"] for c, r in zip(dfb, R)), "apim", sum(r["apim_auto"]["route"]==r["label"] for r in R))
o = [r["apim_auto"]["ms"]-r["apim_pinned"]["ms"] for r in R if ok(r,"apim_auto") and ok(r,"apim_pinned")]
print("routing overhead auto-pinned ms p50/p95", round(pct(o,.5)), round(pct(o,.95)), "n", len(o))
for k in ("direct","apim_auto","apim_pinned","foundry_mr"):
    v=[r[k]["ms"] for r in R if ok(r,k)]; print(k, "p50/p95", round(pct(v,.5)), round(pct(v,.95)))
def cls(m):
    m=(m or "").lower()
    if "codex" in m: return "code"
    if "nano" in m or "mini" in m: return "small"
    return "strong"
fm=Counter(r["foundry_mr"]["model"] for r in R if ok(r,"foundry_mr")); print("foundry models", dict(fm))
print("foundry acc(class-mapped)", sum(cls(r["foundry_mr"]["model"])==r["label"] for r in R if ok(r,"foundry_mr")), "/", sum(ok(r,"foundry_mr") for r in R))
print("errs", [ (r["id"], r["apim_auto"]["err"]) for r in R if not ok(r,"apim_auto")][:3], [r["foundry_mr"]["err"] for r in R if not ok(r,"foundry_mr")][:2])
