"""Build + freeze the router benchmark dataset (t_38bc0c31). Labels come from a task-type rubric applied per SOURCE,
before any router runs:  small = everyday chit-chat / simple instruction (Dolly open_qa, classification, brainstorming,
                         summarization, creative short) ;
                         strong = multi-step maths/reasoning or expert knowledge (GSM8K, MMLU college/professional STEM+law);
                         code = write/fix/explain code (HumanEval, MBPP).
Sampling is seeded; the file's SHA-256 is recorded in labels.lock."""
import hashlib, json, random, urllib.parse, urllib.request
random.seed(38)
def rows(ds, cfg, split, off, n=100):
    u = "https://datasets-server.huggingface.co/rows?" + urllib.parse.urlencode({"dataset": ds, "config": cfg, "split": split, "offset": off, "length": n})
    return [r["row"] for r in json.load(urllib.request.urlopen(u, timeout=60))["rows"]]
out = []
def add(label, src, prompt, sid):
    out.append({"id": f"{src}:{sid}", "label": label, "source": src, "prompt": prompt.strip()})
# code
he = rows("openai/openai_humaneval", "openai_humaneval", "test", 0, 100) + rows("openai/openai_humaneval", "openai_humaneval", "test", 100, 64)
for r in random.sample(he, 40): add("code", "humaneval", "Complete this Python function:\n\n" + r["prompt"], r["task_id"])
mb = rows("google-research-datasets/mbpp", "sanitized", "test", 0, 100) + rows("google-research-datasets/mbpp", "sanitized", "test", 100, 100)
for r in random.sample(mb, 40): add("code", "mbpp", r["prompt"], r["task_id"])
# strong
gs = rows("openai/gsm8k", "main", "test", 0, 100) + rows("openai/gsm8k", "main", "test", 500, 100)
for r in random.sample(gs, 40): add("strong", "gsm8k", r["question"], hashlib.md5(r["question"].encode()).hexdigest()[:8])
for sub in ["college_mathematics", "college_physics", "professional_law", "formal_logic", "abstract_algebra"]:
    mm = rows("cais/mmlu", sub, "test", 0, 100)
    for r in random.sample(mm, 8):
        q = r["question"] + "\n" + "\n".join(f"{'ABCD'[i]}. {c}" for i, c in enumerate(r["choices"])) + "\nAnswer with the letter and a brief justification."
        add("strong", f"mmlu/{sub}", q, hashlib.md5(r["question"].encode()).hexdigest()[:8])
# small
pool = []
for off in range(0, 3000, 100):
    pool += rows("databricks/databricks-dolly-15k", "default", "train", off, 100)
want = {"open_qa": 20, "classification": 15, "brainstorming": 15, "summarization": 10, "creative_writing": 10, "general_qa": 10}
for cat, n in want.items():
    c = [r for r in pool if r["category"] == cat and len(r["instruction"]) < 300 and len(r.get("context") or "") < 1200]
    for i, r in enumerate(random.sample(c, n)):
        p = r["instruction"] + (("\n\n" + r["context"]) if r.get("context") else "")
        add("small", f"dolly/{cat}", p, hashlib.md5(p.encode()).hexdigest()[:8])
ids = [o["id"] for o in out]; assert len(ids) == len(set(ids))
random.shuffle(out)
data = "\n".join(json.dumps(o, ensure_ascii=False) for o in out) + "\n"
open("dataset.jsonl", "w").write(data)
from collections import Counter
lock = {"n": len(out), "per_class": Counter(o["label"] for o in out), "sha256": hashlib.sha256(data.encode()).hexdigest()}
open("labels.lock", "w").write(json.dumps(lock, indent=1)); print(lock)
