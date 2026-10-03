"""Reviewer decisions on changed traces (t_ebf27d4e): default unreviewed, explicit decide/revise/clear, bound to
entry+typed id+metric+both fingerprints (not row position), repeated entries scoped separately, rebuild carries only
exact-key decisions, report == frozen scope + decisions, untouched entries unreviewed."""
import copy, json
from test_reviewed_trace import ROW, entry, node, pack, fp
from test_changed_traces import mk

PRE = ("const H=new Map();for(const r of rows)H.set(L.traceProjection(r),await L.sha256Hex(L.traceProjection(r)));"
       "for(const e of p.entries){const s=e.claimed.trace_snap;if(s&&s.canon)H.set(s.canon,await L.sha256Hex(s.canon));}"
       "const CT=rs=>L.changedTraces(L.inspectOutcome(rs,p,c=>H.get(c)));")


def run(rows, ents, body, rows2=None):
    return node(f"const rows={json.dumps(rows)};const rows2={json.dumps(rows2 or rows)};"
                f"const p=L.parseOutcomeFile({json.dumps(json.dumps(pack(ents)))});"
                + PRE +
                "for(const r of rows2)H.set(L.traceProjection(r),await L.sha256Hex(L.traceProjection(r)));" + body)


def setup():
    a, b, c = mk("a"), mk("b"), mk(7)
    a2 = copy.deepcopy(a); a2["query"] = "q2"
    b2 = copy.deepcopy(b); b2["context"] = None
    c2 = copy.deepcopy(c); c2["meta"] = {}
    ents = [entry(a), entry(b, snap=False), entry(c), entry(mk("same")), entry(a), entry(mk("gone"))]
    for i, x in enumerate(ents): x["entry"] = i + 1
    return [a2, b2, c2, mk("same")], ents


def test_default_decide_revise_clear_and_report():
    rows, ents = setup()
    out = run(rows, ents, """const ct=CT(rows);const D=new Map();const s0=L.ctReviewState(ct,D);
      const e=n=>ct.entries.find(x=>x.entry===n);
      const r1=L.ctDecide(D,e(1),'accept_change',' looks right ','T1');const r2=L.ctDecide(D,e(2),'needs_relabel','','T2');
      const bad=L.ctDecide(D,e(4),'accept_change','','T');const bad2=L.ctDecide(D,e(1),'approve','','T');
      const long=L.ctDecide(D,e(3),'accept_change','x'.repeat(L.CT_NOTE_MAX+1),'T');
      const rv=L.ctDecide(D,e(1),'needs_relabel','revised','T3');const s1=L.ctReviewState(ct,D);
      const rep1=L.changedTracesReport(ct,{},D);D.delete(L.ctDecisionKey(e(2)));const s2=L.ctReviewState(ct,D);
      return {queue:ct.queue,s0,s1,s2,r1:r1.ok,r2:r2.ok,bad,bad2:bad2.ok,long:long.ok,rv:!!rv.prev,rep1}""")
    assert out["queue"] == [1, 2, 3, 5]
    assert out["s0"]["counts"] == {"changed": 4, "accept_change": 0, "needs_relabel": 0, "unreviewed": 4}
    assert out["r1"] and out["r2"] and not out["bad"]["ok"] and not out["bad2"] and not out["long"] and out["rv"]
    assert out["s1"]["counts"] == {"changed": 4, "accept_change": 0, "needs_relabel": 2, "unreviewed": 2} and out["s1"]["remaining"] == 2
    assert out["s2"]["counts"]["unreviewed"] == 3
    rep = out["rep1"]; ch = {x["entry"]: x for x in rep["changed_entries"]}
    assert rep["version"] == 2 and rep["reviewer_decisions"]["counts"] == out["s1"]["counts"]
    assert ch[1]["reviewer_decision"] == {"status": "needs_relabel", "note": "revised", "decided_at": "T3", "revised": True}
    assert ch[2]["reviewer_decision"]["status"] == "needs_relabel" and ch[2]["comparison"] == "hash_only" and ch[2]["reason"]
    # repeated case "a" at entry 5 is its own scope: deciding entry 1 did not decide it
    assert ch[5]["reviewer_decision"]["status"] == "unreviewed" and ch[3]["reviewer_decision"]["status"] == "unreviewed"
    assert ch[1]["fingerprint_at_their_action"] == fp(mk("a")) and ch[1]["fingerprint_now"] == fp(rows[0])
    assert all("reviewer_decision" not in x for x in rep["other_entries"])
    s = json.dumps(rep); assert "api_key" not in s and "human_intent_resolution" not in s


def test_rebuild_carries_only_exact_bytes_and_row_position_irrelevant():
    rows, ents = setup()
    moved = [rows[3], rows[2], rows[1], rows[0]]                            # same bytes, different row positions
    edited = copy.deepcopy(rows); edited[0]["query"] = "q3"                 # entry 1/5 case bytes changed again
    out = run(rows, ents, """const ct=CT(rows);const D=new Map();const e=n=>ct.entries.find(x=>x.entry===n);
      for(const n of [1,2,3,5])L.ctDecide(D,e(n),'accept_change','','T');
      const m=L.ctCarry(D,CT(rows2));const x=L.ctCarry(D,CT(rows3));const ctx=CT(rows3);
      return {m:[m.kept,m.dropped],x:[x.kept,x.dropped],xs:L.ctReviewState(ctx,x.decs).counts}""".replace(
        "const ct=", f"const rows3={json.dumps(edited)};for(const r of rows3)H.set(L.traceProjection(r),await L.sha256Hex(L.traceProjection(r)));const ct="), rows2=moved)
    assert out["m"] == [4, 0]
    assert out["x"] == [2, 2] and out["xs"] == {"changed": 4, "accept_change": 2, "needs_relabel": 0, "unreviewed": 2}
