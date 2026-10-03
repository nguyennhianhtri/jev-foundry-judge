"""Trace fingerprint (jfj-trace-v1): projection excludes labels, sorts keys, keeps array order; export at action time;
inspect recomputes independently against the uniquely matched current case; legacy/malformed/unsupported honest."""
import hashlib, json, shutil, subprocess
from pathlib import Path
import pytest

JS = Path(__file__).resolve().parents[1] / "app" / "static" / "label_coverage.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def node(body):
    code = ("const L=require(process.argv[1]);(async()=>{const out=await (async()=>{" + body +
            "})();process.stdout.write(JSON.stringify(out,(k,v)=>k==='row'?undefined:v))})()")
    return json.loads(subprocess.run(["node", "-e", code, str(JS)], capture_output=True, text=True, check=True).stdout)


def canon(v):  # independent Python re-implementation of the documented projection
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canon(v[k]) for k in sorted(v)) + "}"
    if isinstance(v, list):
        return "[" + ",".join(canon(x) for x in v) + "]"
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def fp(row):
    return hashlib.sha256(canon({k: v for k, v in row.items() if not k.startswith("human_")}).encode()).hexdigest()


RICH = {"id": "r", "query": [{"role": "user", "content": "Book é"}], "response": [
    {"role": "assistant", "content": [{"type": "tool_call", "name": "book", "arguments": {"d": 1, "a": 2}}]},
    {"role": "tool", "content": [{"type": "tool_result", "tool_result": "ok"}]}, {"role": "assistant", "content": "done"}],
    "context": "c", "human_intent_resolution": 4}


def test_projection_and_hash_match_independent_python():
    o = node(f"const r={json.dumps(RICH)};return {{p:L.traceProjection(r),h:await L.sha256Hex(L.traceProjection(r))}}")
    base = {k: v for k, v in RICH.items() if not k.startswith("human_")}
    assert o["p"] == canon(base) and o["h"] == fp(RICH)


def test_relabel_and_key_order_same_but_answer_tool_context_and_array_order_change():
    r = RICH
    relabel = {**r, "human_intent_resolution": 1, "human_task_adherence": 5}
    reordered = json.loads(json.dumps({k: r[k] for k in reversed(list(r))}))
    reordered["response"][0]["content"][0]["arguments"] = {"a": 2, "d": 1}
    assert fp(relabel) == fp(r) == fp(reordered)
    ans = json.loads(json.dumps(r)); ans["response"][2]["content"] = "done!"
    tool = json.loads(json.dumps(r)); tool["response"][0]["content"][0]["arguments"]["d"] = 2
    ctx = {**r, "context": "c2"}
    order = json.loads(json.dumps(r)); order["response"] = [order["response"][1], order["response"][0], order["response"][2]]
    hs = node("return await Promise.all(" + json.dumps([relabel, reordered, ans, tool, ctx, order]) + ".map(x=>L.sha256Hex(L.traceProjection(x))))")
    assert hs[0] == hs[1] == fp(r) and len({fp(r), *hs[2:]}) == 5


def pack(entries):
    oc = {k: 0 for k in ["saved", "confirmed", "skipped", "not_reviewed"]}
    sc = {k: 0 for k in ["matched", "drifted", "missing", "ambiguous", "invalid"]}
    for e in entries:
        oc[e["outcome"]] += 1; sc[e["current_status"]] += 1
    return {"kind": "jev-foundry-judge/label-checklist-outcome", "version": 1, "entries_total": len(entries),
            "outcome_counts": oc, "status_counts": sc, "entries": entries}


def E(id, out="confirmed", tfp="absent"):
    P = {"present": True, "value": 3}
    e = {"id": id, "metric": "intent_resolution", "file_before": {"present": False}, "file_after": P, "current_status": "matched",
         "current_label": P, "outcome": out, "outcome_label": P if out in ("saved", "confirmed") else None}
    if tfp != "absent": e["trace_fingerprint"] = tfp
    return e


def test_inspect_recomputes_per_entry_classification():
    same = {"id": "s", "query": "q", "response": "a", "human_intent_resolution": 3}
    ok = lambda row: {"scheme": "jfj-trace-v1", "alg": "SHA-256", "digest": fp(row), "taken": "at_action"}
    rows = [same, {"id": "c", "query": "q", "response": "CHANGED", "human_intent_resolution": 3}, {"id": "d", "query": "q"}, {"id": "d", "query": "q"},
            {"id": "7", "query": "q"}]
    ents = [E("s", tfp=ok(same)), E("c", tfp=ok({"id": "c", "query": "q", "response": "a"})), E("legacy"), E("s"),
            E("d", tfp=ok({"id": "d", "query": "q"})), E(7, tfp=ok({"id": 7, "query": "q"})), E("gone", tfp=ok(same)),
            E("s", tfp={**ok(same), "scheme": "jfj-trace-v9"}), E("s", tfp={**ok(same), "digest": "XYZ"}), E("s", "skipped", ok(same))]
    body = (f"const rows={json.dumps(rows)};const p=L.parseOutcomeFile({json.dumps(json.dumps(pack(ents)))});const snap=JSON.stringify(rows);"
            "const H=new Map();const first=L.inspectOutcome(rows,p,c=>H.get(c));"
            "for(const c of first.pending)H.set(c,await L.sha256Hex(c));const r=L.inspectOutcome(rows,p,c=>H.get(c));"
            "return {first:first.trace_vs_now,t:r.entries.map(e=>e.trace_vs_now),lbl:r.entries.map(e=>e.claimed_vs_now),c:r.trace_vs_now,same:JSON.stringify(rows)===snap}")
    o = node(body)
    assert o["same"] and o["first"]["pending"] == 2
    assert o["t"] == ["same", "changed", "unavailable", "unavailable", "not_checkable", "not_checkable", "not_checkable",
                      "unsupported", "malformed", "malformed"]
    assert o["lbl"][:2] == ["same", "same"]          # label same on both: only the trace separates them
    assert sum(o["c"].values()) == 10 and o["c"]["same"] == 1 and o["c"]["changed"] == 1


def test_export_carries_action_time_fingerprint_not_a_later_trace():
    body = ("const rows=[{id:'a',query:'q',response:'x',human_intent_resolution:3}];"
            "const p=L.parseChangesFile(JSON.stringify({kind:'jev-foundry-judge/label-session-changes',version:1,cases:[{id:'a',changes:[{metric:'intent_resolution',before:{present:false},after:{present:true,value:3}}]}]}));"
            "const chk={items:p.items,skipped:new Set(),acts:new Map()};const r=rows[0];"
            "const a={action:'confirmed',at:'T',row:r,sig:JSON.stringify(r),value:{present:true,value:3}};const proj=L.traceProjection(r);"
            "a.fp=await L.sha256Hex(proj);chk.acts.set(0,a);const before=a.fp;r.response='ZQXLATER';"
            "const o=L.checklistOutcome(rows,chk,{});const e=o.entries[0];"
            "return {e,before,later:await L.sha256Hex(L.traceProjection(r)),hasTrace:JSON.stringify(o).includes('ZQXLATER')}")
    o = node(body)
    e = o["e"]
    assert e["trace_fingerprint"] == {"scheme": "jfj-trace-v1", "alg": "SHA-256", "digest": o["before"], "taken": "at_action"}
    assert o["before"] == fp({"id": "a", "query": "q", "response": "x"}) != o["later"]
    assert e["evidence"] == "stale" and not o["hasTrace"]
