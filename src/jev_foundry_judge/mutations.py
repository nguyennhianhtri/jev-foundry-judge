"""Deterministic test-case generators ("mutations").

Jev is a judge, not a text generator, so new cases are produced by code: take a good
row and inject ONE known defect. The expected human label for the affected metric is
set low, so each generated case is a labelled regression probe. No LLM involved.
"""
from __future__ import annotations

import copy
import re

from .evaluators import _extract_tool_calls


def _assistant_text_msgs(resp):
    return [m for m in resp if isinstance(m, dict) and m.get("role") == "assistant"
            and isinstance(m.get("content"), list) and any(c.get("type") == "text" for c in m["content"])]


def _is_call(m):
    return isinstance(m, dict) and isinstance(m.get("content"), list) and any(
        c.get("type") == "tool_call" for c in m["content"])


def drop_tool_calls(row):
    r = copy.deepcopy(row)
    if not isinstance(r.get("response"), list) or not _extract_tool_calls(r["response"], None):
        return None
    r["response"] = [m for m in r["response"] if not _is_call(m) and m.get("role") != "tool"]
    r.update(human_tool_call_accuracy=1, human_task_adherence=min(row.get("human_task_adherence", 5), 2))
    r.pop("human_groundedness", None)
    return r, "removed every tool call; the answer is now unverified"


def corrupt_argument(row):
    r = copy.deepcopy(row)
    for m in r.get("response") or []:
        if _is_call(m):
            for c in m["content"]:
                args = c.get("arguments") or {}
                for k, v in args.items():
                    if isinstance(v, str):
                        args[k] = re.sub(r"\d", lambda d: str((int(d.group()) + 3) % 10), v) if re.search(r"\d", v) else v[::-1]
                        r.update(human_tool_call_accuracy=1)
                        return r, f"changed tool argument `{k}` so it no longer matches the user's request"
    return None


def inject_unsupported_claim(row):
    r = copy.deepcopy(row)
    msgs = _assistant_text_msgs(r.get("response") or [])
    if not msgs and isinstance(r.get("response"), str):
        r["response"] += " As a bonus, you also get a 20% loyalty discount on your next purchase."
    elif msgs:
        t = msgs[-1]["content"][-1]
        t["text"] += " As a bonus, you also get a 20% loyalty discount on your next purchase."
    else:
        return None
    if "human_groundedness" in row:
        r["human_groundedness"] = 1
    r["human_task_adherence"] = min(row.get("human_task_adherence", 5), 3)
    return r, "appended an invented 20% discount claim"


def off_topic_answer(row):
    r = copy.deepcopy(row)
    txt = "Thanks for reaching out! By the way, have you seen our new range of smart home products? They're on sale this week."
    if isinstance(r.get("response"), list):
        r["response"] = [m for m in r["response"] if m.get("role") != "assistant" or _is_call(m)] + [
            {"role": "assistant", "content": [{"type": "text", "text": txt}]}]
    else:
        r["response"] = txt
    r.update(human_intent_resolution=1, human_task_adherence=min(row.get("human_task_adherence", 5), 2))
    if "human_groundedness" in row:
        r["human_groundedness"] = 2
    return r, "replaced the final answer with an off-topic upsell"


MUTATIONS = {"drop_tool_calls": drop_tool_calls, "corrupt_argument": corrupt_argument,
             "inject_unsupported_claim": inject_unsupported_claim, "off_topic_answer": off_topic_answer}


def generate(row: dict, kinds: list[str] | None = None) -> list[dict]:
    out = []
    for k in kinds or list(MUTATIONS):
        res = MUTATIONS[k](row)
        if res:
            r, why = res
            r["id"] = f"{row.get('id', 'row')}~{k}"
            r["note"] = f"generated: {why}"
            r["generated"] = k
            out.append(r)
    return out
