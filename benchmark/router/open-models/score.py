"""Score open-weight decision models on the frozen 240-prompt router benchmark.

Same dataset, labels, model cards, instruction and fallback policy as the Jev run in ../results.json.
Inputs: <model>.csv with id,label,pred,p_small,p_strong,p_code,conf,ms (one row per prompt).
Output: results.json in this folder.
"""
import csv, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "src"))
from jev_foundry_judge import router as jr  # noqa: E402

M = jr.DEFAULT_MODELS; K = [m["key"] for m in M]; PR = {m["key"]: m for m in M}; TIN, TOUT = 500, 400
cost = lambda k: (TIN * PR[k]["in"] + TOUT * PR[k]["out"]) / 1e6
VM_USD_PER_HOUR = 0.726  # Standard_D16as_v7, East US 2, Linux pay-as-you-go retail price (prices.azure.com, Oct 2026)
# Container Apps serverless A100: GPU meter only ($0.000651/s, azure.microsoft.com pricing, Oct 2026). vCPU and memory meters are extra,
# so this is a lower bound.
A100_GPU_USD_PER_HOUR = 0.000651 * 3600
RUNS = {
    "clef_flash": ("clef_raw.csv", "Clef-flash (Cloudflare, 9B, Apache-2.0), CPU"),
    "clm_8b": ("clm_raw_str.csv", "CLM-8B (Qwen3-8B Q8 GGUF), CPU"),
    "pplx_decider": ("pplx_decider_raw.csv", "pplx-decider-v1.1-27b (Perplexity, 27B, Apache-2.0), A100 80GB"),
}


def q(v, p):
    s = sorted(v); return s[min(len(s) - 1, max(0, round(p * (len(s) - 1))))]


def score(key, rows, preds, label):
    y = [r["label"] for r in rows]; n = len(y)
    cm = {a: {b: 0 for b in K} for a in K}
    for a, b in zip(y, preds): cm[a][b] += 1
    f1 = []
    for c in K:
        tp = cm[c][c]; fp = sum(cm[a][c] for a in K) - tp; fn = sum(cm[c].values()) - tp
        p = tp / (tp + fp) if tp + fp else 0; r = tp / (tp + fn) if tp + fn else 0; f1.append(2 * p * r / (p + r) if p + r else 0)
    hard = [i for i in range(n) if y[i] != "small"]
    ms = [float(r["ms"]) for r in rows]
    return {"key": key, "label": label, "n": n, "accuracy": round(sum(a == b for a, b in zip(y, preds)) / n, 4),
            "macro_f1": round(sum(f1) / 3, 4), "confusion": cm,
            "quality_risk": round(sum(preds[i] == "small" for i in hard) / len(hard), 4),
            "saving_vs_strong": round(1 - sum(cost(p) for p in preds) / (n * cost("strong")), 4),
            "latency_p50_ms": round(q(ms, .5), 1), "latency_p95_ms": round(q(ms, .95), 1),
            # one sequential request at a time on one VM: cost of the VM-seconds each route occupied
            "usd_per_1k_routes_vm_time": round(1000 * (sum(ms) / n / 1000) * (A100_GPU_USD_PER_HOUR if key.startswith("pplx") else VM_USD_PER_HOUR) / 3600, 4)}


out = []
for key, (fn, label) in RUNS.items():
    rows = list(csv.DictReader(open(os.path.join(HERE, fn))))
    raw = [r["pred"] for r in rows]
    out.append(score(key, rows, raw, label))
    pol = [jr.apply_policy({k: float(r[f"p_{k}"]) for k in K}, float(r["conf"]), M, "strong", .6, None)["routed"] for r in rows]
    out.append(score(key + "_pol", rows, pol, label + " + policy (conf<0.6 → strong)"))

res = {"version": "router-bench-1/open-models", "dataset_sha256": json.load(open(os.path.join(HERE, "..", "labels.lock")))["sha256"],
       "hardware": "Clef-flash and CLM-8B: Azure Standard_D16as_v7 (16 vCPU, 64 GB, no GPU), East US 2. pplx-decider: Container Apps serverless NVIDIA A100 80GB, Sweden Central, called over HTTPS (latency includes the network hop)",
       "method": "Same 240 frozen prompts, labels, model cards and instruction as the Jev run; zero-shot, one request at a time, latency measured on the VM (no network hop).",
       "vm_usd_per_hour": VM_USD_PER_HOUR, "routers": out,
       "limits": "One run, n=240 (±~5 pts at 95%). CPU latency is the reference PyTorch path without fused kernels; a GPU is ~10-50x faster. "
                 "Cost per route assumes one sequential request at a time on an always-on VM; idle time is not counted."}
json.dump(res, open(os.path.join(HERE, "results.json"), "w"), indent=1)
for r in out:
    print(f"{r['label']:<70} acc {r['accuracy']:.1%}  saving {r['saving_vs_strong']:.0%}  p50 {r['latency_p50_ms']:.0f} ms  ${r['usd_per_1k_routes_vm_time']}/1k")
