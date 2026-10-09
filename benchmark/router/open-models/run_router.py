"""Record one decision model's answers on the frozen 240-prompt router benchmark (same instruction and model cards as
the Jev run). Writes <name>_raw.csv for score.py. Usage from repo root:
    JEV_URL=... JEV_MODEL=jev-latest JEV_API_KEY=... PYTHONPATH=src python benchmark/router/open-models/run_router.py pplx_decider
"""
import csv, json, os, sys, time
from jev_foundry_judge import router as jr
from jev_foundry_judge.jev_client import JevClient

HERE = os.path.dirname(os.path.abspath(__file__))
name = sys.argv[1]
rows = [json.loads(l) for l in open(os.path.join(HERE, "..", "dataset.jsonl"))]
client = JevClient(os.environ["JEV_API_KEY"], timeout=120)
out = csv.writer(open(os.path.join(HERE, f"{name}_raw.csv"), "w", newline=""))
out.writerow(["id", "label", "pred", "p_small", "p_strong", "p_code", "conf", "ms"])
for r in rows:
    t0 = time.time()
    d = jr.route(client, r["prompt"], jr.DEFAULT_MODELS)
    ms = (time.time() - t0) * 1000
    p = d["probabilities"]
    out.writerow([r["id"], r["label"], max(p, key=p.get), p["small"], p["strong"], p["code"], d["confidence"], round(ms, 1)])
