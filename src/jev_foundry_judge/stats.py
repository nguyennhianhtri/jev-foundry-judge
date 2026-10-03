"""Benchmark statistics: agreement, latency percentiles, cost per 1k evaluations."""
from __future__ import annotations

import math

from .evaluators import METRICS


def pct(xs: list[float], p: float) -> float | None:
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return round(xs[lo] + (xs[hi] - xs[lo]) * (k - lo), 1)


def _pearson(a, b):
    n = len(a)
    if n < 3:
        return None
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    if va == 0 or vb == 0:
        return None
    return round(sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb), 3)


def comparable(v) -> bool:
    """A real, finite numeric score. None / not_applicable / errors / NaN / bools are never comparable."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def agreement(pairs: list[tuple[float, float]], threshold: float = 3) -> dict:
    """pass/fail agreement at threshold, mean abs error on 1-5, Pearson r."""
    pairs = [(a, b) for a, b in pairs if comparable(a) and comparable(b)]
    if not pairs:
        return {"n": 0}
    a, b = [p[0] for p in pairs], [p[1] for p in pairs]
    pf = sum((x >= threshold) == (y >= threshold) for x, y in pairs) / len(pairs)
    mae = sum(abs(x - y) for x, y in pairs) / len(pairs)
    return {"n": len(pairs), "pass_fail_agreement": round(pf, 3), "mae": round(mae, 2), "pearson": _pearson(a, b)}


def summarize(results: list[dict], threshold: float = 3) -> dict:
    """results: [{id, human:{m:v}, jev:{m:score}, jev_meta:{latency_ms,input_tokens,usd},
                  llm:{m:{score,latency_ms,usd,...}}}]"""
    out: dict = {"rows": len(results), "threshold": threshold, "metrics": {}}
    jl = [r["jev_meta"]["latency_ms"] for r in results if r.get("jev_meta")]
    jusd = sum(r["jev_meta"]["usd"] for r in results if r.get("jev_meta"))
    jtok = sum(r["jev_meta"]["input_tokens"] for r in results if r.get("jev_meta"))
    jcalls = len(jl)
    jev_evals = sum(1 for r in results for m in METRICS if (r.get("jev") or {}).get(m) is not None)
    out["jev"] = {"calls": jcalls, "evaluations": jev_evals, "p50_ms": pct(jl, .5), "p95_ms": pct(jl, .95),
                  "total_usd": round(jusd, 6), "input_tokens": jtok,
                  "usd_per_1k_evals": round(jusd / jev_evals * 1000, 4) if jev_evals else None,
                  "usd_per_1k_rows": round(jusd / jcalls * 1000, 4) if jcalls else None}
    ll, lusd, lev = [], 0.0, 0
    row_lat = []
    for r in results:
        rl = 0.0
        for m, v in (r.get("llm") or {}).items():
            if v and v.get("score") is not None:
                ll.append(v["latency_ms"]); lusd += v.get("usd", 0); lev += 1; rl += v["latency_ms"]
        if rl:
            row_lat.append(rl)
    out["llm"] = {"evaluations": lev, "p50_ms_per_metric": pct(ll, .5), "p95_ms_per_metric": pct(ll, .95),
                  "p50_ms_per_row_sequential": pct(row_lat, .5),
                  "total_usd": round(lusd, 6), "usd_per_1k_evals": round(lusd / lev * 1000, 4) if lev else None}
    for m in METRICS:
        j = [(r.get("jev") or {}).get(m) for r in results]
        h = [(r.get("human") or {}).get(m) for r in results]
        l = [((r.get("llm") or {}).get(m) or {}).get("score") for r in results]
        js = [x for x in j if x is not None]
        out["metrics"][m] = {
            "jev_mean": round(math.fsum(js) / len(js), 2) if js else None,
            "jev_pass_rate": round(sum(x >= threshold for x in js) / len(js), 3) if js else None,
            "jev_vs_human": agreement(list(zip(j, h)), threshold),
            "llm_vs_human": agreement(list(zip(l, h)), threshold),
            "jev_vs_llm": agreement(list(zip(j, l)), threshold),
        }

    def pool(key):
        pairs = []
        for r in results:
            for m in METRICS:
                a = (r.get("jev") or {}).get(m) if key[0] == "jev" else ((r.get("llm") or {}).get(m) or {}).get("score")
                b = (r.get("human") or {}).get(m) if key[1] == "human" else ((r.get("llm") or {}).get(m) or {}).get("score")
                pairs.append((a, b))
        return agreement(pairs, threshold)
    out["overall"] = {"jev_vs_human": pool(("jev", "human")), "llm_vs_human": pool(("llm", "human")),
                      "jev_vs_llm": pool(("jev", "llm"))}
    out["disagreements"] = disagreements(results, threshold)
    return out


def _score(r: dict, judge: str, m: str):
    if judge == "jev":
        return (r.get("jev") or {}).get(m)
    if judge == "human":
        return (r.get("human") or {}).get(m)
    return ((r.get("llm") or {}).get(m) or {}).get("score")


def disagreements(results: list[dict], threshold: float = 3) -> dict:
    """Exact pass/fail disagreements at the SAME threshold as agreement().

    Rows are addressed by their position in this run's results (``idx``), never by id, so duplicate
    ids stay distinct. A pair counts only when BOTH scores are finite numbers; anything else is
    reported as excluded (with a reason), never as a fail or a disagreement.
    Returns {comparison: {metric|"all": {comparable, disagree, rows_disagree, excluded:{reason:n},
    items:[{idx,id,metric,a,b,a_pass,b_pass}]}}}.
    """
    comps = {"jev_vs_human": ("jev", "human"), "jev_vs_llm": ("jev", "llm")}
    out: dict = {"threshold": threshold}
    for name, (ja, jb) in comps.items():
        per: dict = {}
        for m in METRICS + ["all"]:
            per[m] = {"comparable": 0, "disagree": 0, "rows_disagree": 0, "rows_comparable": 0,
                      "excluded": {}, "items": []}
        for i, r in enumerate(results):
            for m in METRICS:
                a, b = _score(r, ja, m), _score(r, jb, m)
                if comparable(a) and comparable(b):
                    ap, bp = a >= threshold, b >= threshold
                    item = {"idx": i, "id": r.get("id"), "metric": m, "a": a, "b": b, "a_pass": ap, "b_pass": bp}
                    for k in (m, "all"):
                        per[k]["comparable"] += 1
                        if ap != bp:
                            per[k]["disagree"] += 1
                            per[k]["items"].append(item)
                    continue
                if r.get("error"):
                    why = "row error"
                elif not comparable(a):
                    why = f"no {ja} score" + (" (not applicable)" if ((r.get("jev_detail") or {}).get(m) or {}).get("result") == "not_applicable" and ja == "jev" else "")
                else:
                    why = f"no {jb} score"
                for k in (m, "all"):
                    per[k]["excluded"][why] = per[k]["excluded"].get(why, 0) + 1
        for k, v in per.items():
            v["rows_disagree"] = len({x["idx"] for x in v["items"]})
            ms = METRICS if k == "all" else [k]
            v["rows_comparable"] = sum(1 for r in results if any(
                comparable(_score(r, ja, m)) and comparable(_score(r, jb, m)) for m in ms))
        out[name] = per
    return out
