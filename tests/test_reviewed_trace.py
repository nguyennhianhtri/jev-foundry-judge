"""Opt-in reviewed trace (t_e0414c6a): exported only when includeTrace; inspect uses it only if it hashes to the entry's
own fingerprint; field-level diff keeps null vs absent, 9 vs "9", array order; key order is not a change."""
import copy, hashlib, json, shutil, subprocess
from pathlib import Path
import pytest

JS = Path(__file__).resolve().parents[1] / "app" / "static" / "label_coverage.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def node(body):
    code = ("const L=require(process.argv[1]);(async()=>{const out=await (async()=>{" + body +
            "})();process.stdout.write(JSON.stringify(out,(k,v)=>k==='row'?undefined:v))})()")
    return json.loads(subprocess.run(["node", "-e", code, str(JS)], capture_output=True, text=True, check=True).stdout)


def canon(v):
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canon(v[k]) for k in sorted(v)) + "}"
    if isinstance(v, list):
        return "[" + ",".join(canon(x) for x in v) + "]"
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def proj(row):
    return {k: v for k, v in row.items() if not k.startswith("human_")}


def fp(row):
    return hashlib.sha256(canon(proj(row)).encode()).hexdigest()


ROW = {"id": "t", "query": "q", "response": [{"role": "assistant", "content": [{"type": "tool_call", "name": "b", "arguments": {"n": 2, "r": "A"}}]},
                                             {"role": "assistant", "content": "done"}], "context": "c", "meta": {"x": None}, "human_intent_resolution": 3}


def entry(row, snap=True, **kw):
    e = {"entry": 1, "id": row["id"], "metric": "intent_resolution", "file_before": {"present": False}, "file_after": {"present": True, "value": 3},
         "current_status": "matched", "current_label": {"present": True, "value": 3}, "outcome": "confirmed",
         "outcome_label": {"present": True, "value": 3}, "trace_fingerprint": {"scheme": "jfj-trace-v1", "alg": "SHA-256", "digest": fp(row), "taken": "at_action"}}
    if snap:
        e["reviewed_trace"] = {"scheme": "jfj-trace-v1", "taken": "at_action", "trace": proj(row)}
    e.update(kw)
    return e


def pack(entries):
    oc = {k: 0 for k in ["saved", "confirmed", "skipped", "not_reviewed"]}
    sc = {k: 0 for k in ["matched", "drifted", "missing", "ambiguous", "invalid"]}
    for e in entries:
        oc[e["outcome"]] += 1; sc[e["current_status"]] += 1
    return {"kind": "jev-foundry-judge/label-checklist-outcome", "version": 1, "entries_total": len(entries),
            "outcome_counts": oc, "status_counts": sc, "entries": entries}


def inspect(rows, entries):
    return node(f"const rows={json.dumps(rows)};const p=L.parseOutcomeFile({json.dumps(json.dumps(pack(entries)))});"
                "const H=new Map();for(const r of rows)H.set(L.traceProjection(r),await L.sha256Hex(L.traceProjection(r)));"
                "for(const e of p.entries){const s=e.claimed.trace_snap;if(s&&s.canon)H.set(s.canon,await L.sha256Hex(s.canon));}"
                "return L.inspectOutcome(rows,p,c=>H.get(c))")


def test_export_hash_only_by_default_and_trace_only_when_opted_in():
    body = (f"const r={json.dumps(ROW)};const chk={{items:[{{id:'t',metric:'intent_resolution',before:{{present:false}},after:{{present:true,value:3}}}}],"
            "acts:new Map([[0,{action:'confirmed',row:r,sig:JSON.stringify(r),value:{present:true,value:3},fp:'a'.repeat(64),snap:L.traceProjection(r)}]]),skipped:new Set()};"
            "return [L.checklistOutcome([r],chk,{}),L.checklistOutcome([r],chk,{includeTrace:true})]")
    off, on = node(body)
    assert "reviewed_trace" not in off["entries"][0] and off["reviewed_trace_included"] is False and '"done"' not in json.dumps(off["entries"])
    assert on["reviewed_trace_included"] is True and on["entries"][0]["reviewed_trace"]["trace"] == proj(ROW)
    assert "human_intent_resolution" not in on["entries"][0]["reviewed_trace"]["trace"]


def test_diff_values_types_null_absent_order_and_key_reorder():
    cur = copy.deepcopy(ROW)
    cur["response"][0]["content"][0]["arguments"]["n"] = "2"          # number -> string
    cur["response"][1]["content"] = "done!"                           # answer text
    cur["meta"] = {"y": 1}                                            # x:null removed, y added
    cur["context"] = None                                             # string -> null
    r = inspect([cur], [entry(ROW)])["entries"][0]
    assert r["trace_vs_now"] == "changed" and r["snap"] == "verified"
    got = {d["path"]: d for d in r["diff"]}
    assert got["response[0].content[0].arguments.n"] == {"path": "response[0].content[0].arguments.n", "kind": "changed", "before": 2, "after": "2"}
    assert got["response[1].content"]["before"] == "done" and got["response[1].content"]["after"] == "done!"
    assert got["meta.x"]["kind"] == "removed" and got["meta.x"]["before"] is None and "after" not in got["meta.x"]
    assert got["meta.y"] == {"path": "meta.y", "kind": "added", "after": 1}
    assert got["context"]["after"] is None and len(got) == 5
    # key reorder + relabel only -> same, zero diff
    ro = json.loads(json.dumps({k: ROW[k] for k in reversed(list(ROW))})); ro["human_intent_resolution"] = 1
    r2 = inspect([ro], [entry(ROW)])["entries"][0]
    assert r2["trace_vs_now"] == "same" and r2["diff"] == []
    # array order is a change
    sw = copy.deepcopy(ROW); sw["response"].reverse()
    assert inspect([sw], [entry(ROW)])["entries"][0]["diff"]


def test_tampered_or_unbacked_snapshot_is_never_compared():
    bad = entry(ROW); bad["reviewed_trace"]["trace"]["context"] = "forged"
    assert inspect([ROW], [bad])["entries"][0]["snap"] == "mismatch" and "diff" not in inspect([ROW], [bad])["entries"][0]
    nofp = entry(ROW); nofp["trace_fingerprint"]["digest"] = "zz"
    assert inspect([ROW], [nofp])["entries"][0]["snap"] == "unverifiable"
    uns = entry(ROW); uns["reviewed_trace"]["scheme"] = "v9"
    assert inspect([ROW], [uns])["entries"][0]["snap"] == "unsupported"
    mal = entry(ROW); mal["reviewed_trace"] = {"scheme": "jfj-trace-v1", "trace": "text"}
    assert inspect([ROW], [mal])["entries"][0]["snap"] == "malformed"
    legacy = entry(ROW, snap=False)
    assert inspect([ROW], [legacy])["entries"][0]["snap"] == "absent"


def test_no_single_current_case_gives_no_diff():
    d = inspect([ROW, ROW], [entry(ROW)])["entries"][0]
    assert d["trace_vs_now"] == "not_checkable" and "diff" not in d
    t9 = dict(ROW, id=9); e = entry(t9); e["id"] = "9"
    assert "diff" not in inspect([t9], [e])["entries"][0]


def test_diff_uses_hashed_bytes_and_proto_key_is_plain():
    cur = {"id": "n", "a": None, "__proto__": {"z": 1}}
    snap = {"id": "n", "a": 1e400}                                     # Infinity canonicalises to null
    e = entry({"id": "n", "a": None}); e["reviewed_trace"]["trace"] = snap
    e["trace_fingerprint"]["digest"] = fp({"id": "n", "a": None})
    cur2 = json.loads('{"id":"n","a":null,"__proto__":{"z":1}}')
    txt = json.dumps(pack([e])).replace('"a": Infinity', '"a": 1e400')
    r = node(f"const rows=[JSON.parse({json.dumps(json.dumps(cur2))})];const p=L.parseOutcomeFile({json.dumps(txt)});"
             "const H=new Map();for(const r of rows)H.set(L.traceProjection(r),await L.sha256Hex(L.traceProjection(r)));"
             "const s=p.entries[0].claimed.trace_snap;H.set(s.canon,await L.sha256Hex(s.canon));return L.inspectOutcome(rows,p,c=>H.get(c)).entries[0]")
    assert r["snap"] == "verified" and r["diff"] == [{"path": "__proto__", "kind": "added", "after": {"z": 1}}]


def test_diff_cap():
    a = {"id": "c", "v": list(range(500))}; b = {"id": "c", "v": [str(i) for i in range(500)]}
    d = node(f"return L.traceDiff({json.dumps(a)},{json.dumps(b)}).length")
    assert d == node("return L.DIFF_MAX")
