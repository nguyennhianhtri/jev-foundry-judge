"""Re-label handoff (t_8e6db916): open a changed-traces-comparison v2 read-only, validate shape/counts/version, re-match
exact typed id+metric, recompute the current fingerprint vs the reviewed one, verify the earlier fingerprint from the file's
own diff when possible, and derive deduped label-pass targets from valid needs_relabel entries only. Independent oracle =
python hashlib + own canonicaliser (test_reviewed_trace.fp)."""
import copy, json
from test_reviewed_trace import node, fp

KIND = "jev-foundry-judge/changed-traces-comparison"


def row(i, **kw):
    r = {"id": i, "query": "q " + str(i), "response": "ans " + str(i), "human_intent_resolution": 3}
    r.update(kw); return r


def ce(n, old, new, status="needs_relabel", note=None, fields=True, metric="intent_resolution", diff=None, **kw):
    e = {"entry": n, "id": new["id"], "metric": metric, "current_row": None, "comparison": "fields" if fields else "hash_only",
         "claimed_outcome": "confirmed", "claimed_label": {"present": True, "value": 3}, "claimed_at": "T", "label_now": {"present": True, "value": 3},
         "fingerprint_at_their_action": fp(old), "fingerprint_now": fp(new),
         "reviewer_decision": {"status": status, "note": note, "decided_at": None if status == "unreviewed" else "D", "revised": False}}
    if fields:
        d = diff if diff is not None else [{"path": "response", "kind": "changed", "before": old["response"], "after": new["response"]}]
        e.update(fields_changed=len(d), diff_capped=False, diff=d)
    else:
        e["reason"] = "the file does not include their reviewed trace"
    e.update(kw); return e


def pack(ents):
    dc = {"accept_change": 0, "needs_relabel": 0, "unreviewed": 0}
    for e in ents:
        dc[e["reviewer_decision"]["status"]] += 1
    fc = sum(e["comparison"] == "fields" for e in ents)
    return {"kind": KIND, "version": 2, "app_version": "v1.22.0", "generated_at": "G", "frozen_at": "F", "outcome_file": "o.json", "dataset_rows": 9,
            "reviewer_decisions": {"counts": {"changed": len(ents), **dc}, "remaining_unreviewed": dc["unreviewed"], "meaning": "m"},
            "counts": {"entries_total": len(ents) + 2, "changed": len(ents), "field_comparable": fc, "hash_only": len(ents) - fc, "unchanged": 2, "unavailable": 0},
            "unavailable_by_reason": {}, "changed_entries": ents, "other_entries": []}


def check(rows, doc):
    return node(f"const rows={json.dumps(rows)};const p=L.parseComparisonFile({json.dumps(json.dumps(doc))});if(!p.ok)return p;"
                "const H=new Map();const need=c=>{if(!H.has(c))H.set(c,null)};"
                "let r=L.checkHandoff(rows,p,c=>H.has(c)&&H.get(c)!==null?H.get(c):(need(c),undefined));"
                "for(let i=0;i<4&&!r.ready;i++){for(const [c,v] of H)if(v===null)H.set(c,await L.sha256Hex(c));r=L.checkHandoff(rows,p,c=>H.has(c)&&H.get(c)!==null?H.get(c):(need(c),undefined));}"
                "const before=JSON.stringify(rows);r.untouched=JSON.stringify(rows)===before;"
                "r.targets=r.targets.map(t=>({id:t.id,metric:t.metric,idx:t.idx,entries:t.entries,notes:t.notes,fresh:L.handoffTargetFresh(rows,t)}));return {ok:true,p,r}")


def scenario():
    # earlier (A) vs current (B) datasets
    a_old, a_new = row("a", response="OLD a"), row("a", response="NEW a")
    b_old, b_new = row("b", response="OLD b"), row("b", response="NEW b")
    t_old = row("t", response="OLD t", context="ctx")               # tool_call_accuracy n/a for this case
    t_new = row("t", response="NEW t", context="ctx")
    c_old, c_new = row(7, response="OLD 7"), row(7, response="NEW 7")          # typed numeric id
    d_old, d_new = row("dup", response="o"), row("dup", response="n")
    h_old, h_new = row("h", response="OLD h", meta={"x": None}), row("h", response="NEW h", meta={"x": None})
    s_old, s_new = row("s", response="OLD s"), row("s", response="NEW s")      # changed again after comparison
    s_now = row("s", response="NEWER s")
    rows = [a_new, b_new, t_new, c_new, d_new, copy.deepcopy(d_new), h_new, s_now, row("7")]   # "7" string != 7 number
    ents = [ce(1, a_old, a_new, note="answer rewritten"),                     # eligible, verified
            ce(2, a_old, a_new, note="same case again"),                      # duplicate case+metric -> same target
            ce(3, b_old, b_new, status="accept_change", note="fine"),         # never a target
            ce(4, b_old, b_new, status="unreviewed"),                         # never a target
            ce(5, t_old, t_new, metric="tool_call_accuracy"),                 # n/a -> not eligible
            ce(6, c_old, c_new),                                              # eligible numeric id 7
            ce(7, d_old, d_new),                                              # ambiguous
            ce(8, h_old, h_new, fields=False, note="hash only"),              # eligible, earlier not verifiable
            ce(9, s_old, s_new),                                              # changed since -> not eligible
            ce(10, row("gone"), row("gone", response="x")),                   # missing
            ce(11, a_old, a_new, metric="task_adherence"),                    # eligible, second metric same case
            ce(12, b_old, b_new, diff=[{"path": "response", "kind": "changed", "before": "FORGED", "after": "NEW b"}])]  # diff mismatch
    return rows, ents


def test_counts_targets_and_statuses_against_oracle():
    rows, ents = scenario()
    out = check(rows, pack(ents))
    assert out["ok"], out
    r = out["r"]; by = {e["entry"]: e for e in r["entries"]}
    assert r["ready"] and r["untouched"]
    assert r["status_counts"] == {"current": 9, "changed_since": 1, "missing": 1, "ambiguous": 1, "invalid": 0, "pending": 0}
    assert {n: by[n]["earlier"] for n in (1, 2, 6, 8, 11, 12)} == {1: "verified", 2: "verified", 6: "verified", 8: "not_verifiable", 11: "verified", 12: "mismatch"}
    assert [n for n in by if by[n]["eligible"]] == [1, 2, 6, 8, 11]
    assert r["eligible_entries"] == 5 and len(r["targets"]) == 4 and r["target_cases"] == 3
    t = [(x["id"], x["metric"], x["idx"], x["entries"]) for x in r["targets"]]
    assert t == [("a", "intent_resolution", 0, [1, 2]), (7, "intent_resolution", 3, [6]), ("h", "intent_resolution", 6, [8]), ("a", "task_adherence", 0, [11])]
    assert r["targets"][0]["notes"] == [{"entry": 1, "note": "answer rewritten"}, {"entry": 2, "note": "same case again"}]
    assert all(x["fresh"] for x in r["targets"])
    assert not by[3]["eligible"] and not by[4]["eligible"] and "why_not" not in by[3]
    assert "does not apply" in by[5]["why_not"] and by[9]["status"] == "changed_since" and by[7]["status"] == "ambiguous" and by[10]["status"] == "missing"
    assert "inconsistent" in by[12]["why_not"]
    assert by[1]["fp_current"] == fp(rows[0])


def test_whole_file_refusals():
    rows, ents = scenario()
    bad = []
    d = pack(ents); d["version"] = 1; bad.append(d)
    d = pack(ents); d["version"] = 3; bad.append(d)
    d = pack(ents); d["kind"] = "x"; bad.append(d)
    d = pack(ents); d["reviewer_decisions"]["counts"]["needs_relabel"] += 1; bad.append(d)
    d = pack(ents); d["counts"]["changed"] -= 1; bad.append(d)
    d = pack(ents); d["counts"]["hash_only"] += 1; bad.append(d)
    d = pack(ents); d["changed_entries"][0]["reviewer_decision"]["status"] = "approve"; bad.append(d)
    d = pack([]); bad.append(d)
    msgs = [check(rows, x) for x in bad]
    assert all(m["ok"] is False for m in msgs), msgs
    assert "version 1" in msgs[0]["error"] and "unsupported version 3" in msgs[1]["error"]
    assert node('return L.parseComparisonFile("{nope")')["ok"] is False


def test_per_entry_invalid_never_targets():
    rows, ents = scenario()
    x = copy.deepcopy(ents)
    x[0]["id"] = None                                     # no id
    x[5]["fingerprint_now"] = "ABC"                       # malformed fingerprint
    x[7]["entry"] = 1                                     # duplicate entry number with entry 1 (entry 1 already invalid)
    x[10]["metric"] = "safety"                            # unknown metric
    x[3]["reviewer_decision"]["note"] = "x"               # unreviewed with note
    out = check(rows, pack(x)); r = out["r"]
    inv = [e["pos"] for e in r["entries"] if e["status"] == "invalid"]
    assert inv == [1, 4, 6, 11], inv
    assert [(t["id"], t["entries"]) for t in r["targets"]] == [("a", [2]), ("h", [1])]
    assert r["eligible_entries"] == 2


def test_undo_diff_arrays_and_nested():
    old = {"id": "z", "response": [{"role": "assistant", "content": "a"}, {"role": "tool", "content": [1, 2]}], "meta": {"k": 1, "q r": None}}
    new = {"id": "z", "response": [{"role": "assistant", "content": "b"}], "meta": {"k": 2, "n": [1]}, "context": "c"}
    out = node(f"const o={json.dumps(old)},n={json.dumps(new)};const d=L.traceDiff(o,n);"
               "const back=L.undoDiff(L.traceProjection(n),d);return {d,back,want:L.traceProjection(o)}")
    assert out["back"] == out["want"], out


def test_target_fresh_refuses_trace_edit_move_ok():
    out = node("const rows=[{id:'a',query:'q',response:'r'},{id:'b',query:'q',response:'r'}];"
               "const t={id:'a',row:rows[0],proj:L.traceProjection(rows[0])};const r1=L.handoffTargetFresh(rows,t);"
               "rows[0].human_intent_resolution=4;const r2=L.handoffTargetFresh(rows,t);"
               "rows.reverse();const r3=L.handoffTargetFresh(rows,t);rows[1].response='x';const r4=L.handoffTargetFresh(rows,t);"
               "rows[1].response='r';rows.push({id:'a'});const r5=L.handoffTargetFresh(rows,t);return [r1,r2,r3,r4,r5]")
    assert out == [True, True, True, False, False]


def test_undo_diff_proto_key_is_own_key():
    out = node('const o=JSON.parse(\'{"id":"p","meta":{"__proto__":{"a":1}}}\'),n=JSON.parse(\'{"id":"p","meta":{"__proto__":{"a":2}}}\');'
               "const d=L.traceDiff(o,n);return {d,back:L.undoDiff(L.traceProjection(n),d),want:L.traceProjection(o),clean:({}).a===undefined}")
    assert out["back"] == out["want"] and out["clean"], out
