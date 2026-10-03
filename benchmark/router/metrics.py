import csv, json, sys
sys.path.insert(0, "../../src")
from jev_foundry_judge import router as jr
DS = [json.loads(l) for l in open("dataset.jsonl")]; RAW = json.load(open("raw.json"))
M = jr.DEFAULT_MODELS; K = [m["key"] for m in M]; PR = {m["key"]: m for m in M}; TIN, TOUT = 500, 400
cost = lambda k: (TIN * PR[k]["in"] + TOUT * PR[k]["out"]) / 1e6
LAB = {"jev": "Jev Choice (jev-1.13)", "llm": "LLM router (gpt-5.4-mini, low reasoning)", "embed": "Embedding similarity (text-embedding-3-small)", "strong": "Always strong (gpt-5.4)", "jev_pol": "Jev + policy (conf<0.6 → strong)"}
def q(v, p): s = sorted(v); return s[min(len(s) - 1, max(0, round(p * (len(s) - 1))))]
def metr(name, preds, rows=None):
    y = [d["label"] for d in DS]; n = len(y)
    cm = {a: {b: 0 for b in K} for a in K}
    for a, b in zip(y, preds): cm[a][b] += 1
    f1s = []
    for c in K:
        tp = cm[c][c]; fp = sum(cm[a][c] for a in K) - tp; fn = sum(cm[c].values()) - tp
        pr = tp / (tp + fp) if tp + fp else 0; rc = tp / (tp + fn) if tp + fn else 0; f1s.append(2 * pr * rc / (pr + rc) if pr + rc else 0)
    hard = [i for i in range(n) if y[i] != "small"]
    r = {"key": name, "label": LAB[name], "accuracy": sum(a == b for a, b in zip(y, preds)) / n, "macro_f1": sum(f1s) / 3, "confusion": cm,
         "quality_risk": sum(preds[i] == "small" for i in hard) / len(hard),
         "saving_vs_strong": 1 - sum(cost(p) for p in preds) / (n * cost("strong"))}
    if rows:
        ms = [x["ms"] for x in rows]; r.update(latency_p50_ms=round(q(ms, .5), 1), latency_p95_ms=round(q(ms, .95), 1), usd_per_1k_routes=1000 * sum(x["usd"] for x in rows) / n)
        if rows[0].get("probs") is not None:
            bins = [(0, .5), (.5, .8), (.8, .95), (.95, 1.01)]; cal = []
            for lo, hi in bins:
                ix = [i for i, x in enumerate(rows) if x["probs"] and lo <= max(x["probs"].values()) < hi]
                cal.append({"bin": f"{lo:.2f}–{min(hi,1):.2f}", "n": len(ix), "mean_p": sum(max(rows[i]["probs"].values()) for i in ix) / len(ix) if ix else None,
                            "acc": sum(preds[i] == y[i] for i in ix) / len(ix) if ix else None})
            r["calibration"] = cal
            hi = [i for i, x in enumerate(rows) if x["probs"] and max(x["probs"].values()) >= .8]
            r["p_ge_0_8"] = {"n": len(hi), "acc": sum(preds[i] == y[i] for i in hi) / len(hi) if hi else None}
    else:
        r.update(latency_p50_ms=0, latency_p95_ms=0, usd_per_1k_routes=0)
    return r
R = [metr(k, [x["pred"] for x in RAW["raw"][k]], RAW["raw"][k]) for k in ("jev", "llm", "embed")]
jp = [jr.apply_policy(x["probs"], x["conf"], M, "strong", .6, None)["routed"] for x in RAW["raw"]["jev"]]
rp = metr("jev_pol", jp, RAW["raw"]["jev"]); rp.pop("calibration", None); rp.pop("p_ge_0_8", None)
R.insert(1, rp); R.append(metr("strong", ["strong"] * len(DS)))
# per-source accuracy for Jev
src = {}
for d, x in zip(DS, RAW["raw"]["jev"]):
    s = d["source"].split("/")[0]; src.setdefault(s, [0, 0]); src[s][0] += x["pred"] == d["label"]; src[s][1] += 1
j, l, e = R[0], R[2], R[3]
summary = (f"On 240 frozen public prompts (80 per route), Jev Choice routed {j['accuracy']:.0%} correctly (macro-F1 {j['macro_f1']:.2f}) "
           f"vs {l['accuracy']:.0%} for a gpt-5.4-mini LLM router and {e['accuracy']:.0%} for embedding similarity; "
           f"Jev's p50 routing latency was {j['latency_p50_ms']:.0f} ms vs {l['latency_p50_ms']:.0f} ms, at ${j['usd_per_1k_routes']:.3f} vs ${l['usd_per_1k_routes']:.3f} per 1k routes. "
           f"Always-strong is {R[-1]['accuracy']:.0%} by construction (it gets every strong label and nothing else).")
res = {"version": "router-bench-1", "run_at": RAW["run_at"], "run_from": "Singapore, 8 concurrent requests per router",
       "summary": summary, "classes": K, "assumed_tokens": {"in": TIN, "out": TOUT},
       "dataset": {"n": len(DS), "per_class": {c: sum(d["label"] == c for d in DS) for c in K}, "sha256": json.load(open("labels.lock"))["sha256"],
                   "description": "Public prompts, labels frozen by a task-type rubric before any router ran: small = Dolly-15k open QA/classification/brainstorming/summarisation/creative/general QA; strong = GSM8K + MMLU (college maths, college physics, professional law, formal logic, abstract algebra); code = HumanEval + MBPP"},
       "routers": R, "jev_accuracy_by_source": {k: round(a / n, 3) for k, (a, n) in src.items()},
       "laya_slot": "A self-hosted classifier (e.g. an open-source non-autoregressive model) is not wired: no endpoint was available. Adding it = one more router function in benchmark/router/run_bench.py over the same frozen dataset; no numbers are shown for it.",
       "limits": ("Labels are a task-type rubric, not RouterBench-style 'cheapest model that actually answered correctly', so an easy GSM8K item labelled strong may be fine on nano. "
                  "Zero-shot: model cards were written before the run and not tuned on this set. Saving is estimated from list prices and fixed token counts, not billed. "
                  "Latency includes 8-way concurrency and the Singapore→US Jev round trip. One run, no confidence intervals (n=240: ±~5 pts at 95%).")}
json.dump(res, open("results.json", "w"), indent=1)
with open("predictions.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["id", "source", "label", "jev_pred", "jev_p_small", "jev_p_strong", "jev_p_code", "jev_conf", "jev_ms", "jev_policy", "llm_pred", "llm_ms", "embed_pred", "embed_ms"])
    for d, a, pol, b, c in zip(DS, RAW["raw"]["jev"], jp, RAW["raw"]["llm"], RAW["raw"]["embed"]):
        w.writerow([d["id"], d["source"], d["label"], a["pred"], a["probs"]["small"], a["probs"]["strong"], a["probs"]["code"], a["conf"], a["ms"], pol, b["pred"], round(b["ms"], 1), c["pred"], round(c["ms"], 1)])
print(summary)
for r in R: print(f"{r['label'][:34]:34} acc {r['accuracy']:.3f} f1 {r['macro_f1']:.3f} risk {r['quality_risk']:.3f} save {r['saving_vs_strong']:.3f} p50 {r['latency_p50_ms']} p95 {r['latency_p95_ms']} $/1k {r['usd_per_1k_routes']:.4f} {r.get('p_ge_0_8','')}")
print(res["jev_accuracy_by_source"]); print(json.dumps(R[0]["confusion"])); print(json.dumps(R[0]["calibration"])); print(json.dumps(R[2]["confusion"]))
