"""Score a self-hosted open-weight judge on the same 47-conversation benchmark as ../results.

Input: clef_flash_judge.json (per-row 1-5 scores from JevAgentJudge pointed at selfhost/server.py).
Output: summary.json in this folder. Run from repo root: PYTHONPATH=src python benchmark/results/open-models/score.py
"""
import json, os, statistics as st
from jev_foundry_judge.stats import agreement

HERE = os.path.dirname(os.path.abspath(__file__))
DS = {json.loads(l)["id"]: json.loads(l) for l in open(os.path.join(HERE, "..", "dataset.jsonl"))}
M = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]
VM_USD_PER_HOUR = 0.726  # Standard_D16as_v7, East US 2, Linux pay-as-you-go retail

rows = json.load(open(os.path.join(HERE, "clef_flash_judge.json")))
per, allp = {}, []
for m in M:
    p = [(r["scores"][m], DS[r["id"]]["human_" + m]) for r in rows
         if r["scores"].get(m) is not None and DS[r["id"]].get("human_" + m) is not None]
    per[m] = agreement(p); allp += p
ms = sorted(r["ms"] for r in rows)
out = {"judge": "Clef-flash (Cloudflare, 9B, Apache-2.0) via selfhost/server.py, same JevAgentJudge questions and weights",
       "hardware": "Azure Standard_D16as_v7 (16 vCPU, 64 GB, no GPU), East US 2, CPU PyTorch reference kernels",
       "rows": len(rows), "overall_vs_human": agreement(allp), "metrics_vs_human": per,
       "latency_ms_per_conversation": {"p50": round(st.median(ms)), "p95": round(ms[int(.95 * len(ms)) - 1])},
       "usd_per_1k_conversations_vm_time": round(1000 * st.mean(ms) / 1000 * VM_USD_PER_HOUR / 3600, 2),
       "limits": "One run. Questions and weights were tuned on Jev, not re-tuned for Clef. CPU only; a GPU is much faster."}
json.dump(out, open(os.path.join(HERE, "summary.json"), "w"), indent=1)
print(json.dumps(out["overall_vs_human"]), out["latency_ms_per_conversation"], out["usd_per_1k_conversations_vm_time"])
