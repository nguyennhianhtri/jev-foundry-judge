"""Run JevAgentJudge on the 47-conversation benchmark against any System One endpoint and write <name>_judge.json.

Usage (from repo root): JEV_URL=https://host/v1/systemone JEV_MODEL=jev-latest JEV_API_KEY=... \
    PYTHONPATH=src python benchmark/results/open-models/run_judge.py pplx_decider
Then score it with score.py (edit the input file name) or compare with the Jev run in ../results.jsonl.
"""
import json, os, sys, time
from jev_foundry_judge.evaluators import JevAgentJudge

HERE = os.path.dirname(os.path.abspath(__file__))
name = sys.argv[1]
rows = [json.loads(l) for l in open(os.path.join(HERE, "..", "dataset.jsonl"))]
judge = JevAgentJudge(os.environ["JEV_API_KEY"])
out = []
for r in rows:
    t0 = time.time()
    try:
        res = judge(query=r["query"], response=r["response"], tool_definitions=r.get("tool_definitions"),
                    tool_calls=r.get("tool_calls"), context=r.get("context"))
    except Exception as e:  # keep going; a failed row is scored as missing
        print("row", r["id"], "failed:", type(e).__name__, e, flush=True)
        continue
    scores = {m: res.get(m) for m in ("intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness")}
    out.append({"id": r["id"], "ms": round((time.time() - t0) * 1000), "scores": scores})
    print(r["id"], out[-1]["ms"], "ms", flush=True)
json.dump(out, open(os.path.join(HERE, f"{name}_judge.json"), "w"), indent=1)
