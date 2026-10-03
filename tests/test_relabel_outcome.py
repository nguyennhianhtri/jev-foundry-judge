"""Re-label handoff OUTCOME (t_5620223e): per deduped typed id+metric target, the explicit action actually taken
(saved changed / saved unchanged / skipped / not reached), before->after labels with absent != numeric, source entries,
reviewed fingerprint, historical evidence vs checked-now, and Re-check carry that never moves an outcome onto a
changed target. Oracle = python expectations derived from the scenario + hashlib fingerprints (test_reviewed_trace.fp)."""
import json
from test_reviewed_trace import node, fp
from test_relabel_handoff import scenario, pack

PRE = ("const rows={rows};const p=L.parseComparisonFile({doc});"
       "const H=new Map();const dg=c=>{{if(!H.has(c)){{H.set(c,null);return undefined}}return H.get(c)===null?undefined:H.get(c)}};"
       "const chk=async()=>{{let r=L.checkHandoff(rows,p,dg);for(let i=0;i<5&&!r.ready;i++){{for(const [c,v] of H)if(v===null)H.set(c,await L.sha256Hex(c));r=L.checkHandoff(rows,p,dg)}}return r}};"
       "const lab=(r,m)=>Object.hasOwn(r,'human_'+m)?{{present:true,value:r['human_'+m]}}:{{present:false}};"
       "const eq=(a,b)=>a.present===b.present&&(!a.present||JSON.stringify(a.value)===JSON.stringify(b.value));"
       # mirrors app.js onSaved: before = label right before the FIRST Save of this pass, after = label after the latest
       "const save=(h,i,v)=>{{const t=h.chk.targets[i],prev=lab(t.row,t.metric);if(v==null)delete t.row['human_'+t.metric];else t.row['human_'+t.metric]=v;"
       "const cur=lab(t.row,t.metric),old=h.acts.get(t.key),before=old?old.before:prev;"
       "h.acts.set(t.key,{{before,after:cur,changed:!eq(before,cur),saves:(old?.saves||0)+1,at:'T',row:t.row,skippedBefore:old?.skippedBefore||h.skipped.has(t.key)}});h.skipped.delete(t.key)}};"
       "const h={{name:'cmp.json',meta:p.meta,chk:await chk(),acts:new Map(),skipped:new Set(),at:'C'}};"
       "const frozen=JSON.stringify(rows);")


def run(body):
    rows, ents = scenario()
    return node(PRE.format(rows=json.dumps(rows), doc=json.dumps(json.dumps(pack(ents)))) + body), rows


def T(o):  # key targets by (id, metric)
    return {(t["id"], t["metric"]): t for t in o["targets"]}


def test_actions_counts_and_labels_against_oracle():
    out, rows = run("const snap0=JSON.stringify(rows);"
                    "save(h,0,5);"          # a/IR 3 -> 5 (changed)
                    "save(h,1,3);"          # 7/IR 3 -> 3 explicit unchanged Save
                    "h.skipped.add(h.chk.targets[2].key);"   # h/IR skipped
                    # a/TA (index 3) never touched -> not reached, even though opened/Next would not count
                    "const snap1=JSON.stringify(rows);const o=L.handoffOutcome(rows,h,{version:'v',at:'G'});"
                    "return {o,noMut:JSON.stringify(rows)===snap1,txt:JSON.stringify(o)}")
    o = out["o"]; t = T(o)
    assert out["noMut"]
    assert o["kind"] == "jev-foundry-judge/relabel-handoff-outcome" and o["version"] == 1
    assert o["counts"] == {"entries_in_file": 12, "eligible_entries": 5, "not_eligible_entries": 7, "targets": 4, "target_cases": 3,
                           "duplicate_entries_merged": 1, "outcomes_dropped_at_recheck": 0}
    assert o["outcome_counts"] == {"saved_changed": 1, "saved_unchanged": 1, "skipped": 1, "not_reached": 1}
    assert o["evidence_counts"] == {"current": 2, "stale": 0}
    assert o["checked_now_counts"] == {"current": 4, "trace_changed": 0, "missing": 0, "ambiguous": 0}
    a = t[("a", "intent_resolution")]
    assert a["source_entries"] == [1, 2] and a["action"] == "saved" and a["label_changed"] is True
    assert a["label_before"] == {"present": True, "value": 3} and a["label_after"] == {"present": True, "value": 5}
    assert a["reviewed_fingerprint"]["digest"] == fp(rows[0]) and a["evidence"] == "current"
    s7 = t[(7, "intent_resolution")]
    assert s7["action"] == "saved" and s7["label_changed"] is False and s7["label_before"] == s7["label_after"] == {"present": True, "value": 3}
    assert t[("h", "intent_resolution")]["action"] == "skipped" and t[("h", "intent_resolution")]["label_before"] is None
    ta = t[("a", "task_adherence")]
    assert ta["action"] == "not_reached" and ta["label_now"] == {"present": False}
    # reconciliation: every eligible entry is in exactly one target; not-eligible entries listed with reasons
    assert sorted(sum((x["source_entries"] for x in o["targets"]), [])) == [1, 2, 6, 8, 11]
    assert sorted(x["entry"] for x in o["not_eligible_entries"]) == [3, 4, 5, 7, 9, 10, 12]
    assert all(x["why_not_target"] for x in o["not_eligible_entries"])
    # privacy: no trace text, notes or keys in the export
    for leak in ("NEW a", "OLD a", "NEW 7", "answer rewritten", "same case again", "\"ans a\"", "\"q a\"", "api_key", "\"response\"", "\"query\""):
        assert leak not in out["txt"], leak


def test_absent_distinct_from_numeric_and_multi_save():
    out, _ = run("save(h,3,2);save(h,3,null);save(h,3,4);"   # a/TA absent -> 2 -> blank -> 4 : before stays absent
                 "save(h,1,null);save(h,1,3);"                   # 7/IR 3 -> blank -> 3 : net unchanged, saves=2
                 "h.skipped.add(h.chk.targets[2].key);save(h,2,1);"   # skip then save -> saved, skipped_before
                 "return L.handoffOutcome(rows,h,{})")
    t = T(out)
    ta = t[("a", "task_adherence")]
    assert ta["label_before"] == {"present": False} and ta["label_after"] == {"present": True, "value": 4} and ta["saves"] == 3 and ta["label_changed"]
    s7 = t[(7, "intent_resolution")]
    assert s7["saves"] == 2 and s7["label_changed"] is False
    hh = t[("h", "intent_resolution")]
    assert hh["action"] == "saved" and hh["skipped_before"] is True
    assert out["outcome_counts"] == {"saved_changed": 2, "saved_unchanged": 1, "skipped": 0, "not_reached": 1}


def test_stale_after_trace_edit_delete_duplicate_and_label_edit():
    out, _ = run("save(h,0,5);save(h,1,4);save(h,2,2);save(h,3,1);"
                 "const tg=h.chk.targets;"
                 "tg[0].row.response='EDITED';"                              # a: trace changed -> both a targets stale
                 "rows.splice(rows.indexOf(tg[1].row),1);"                   # 7 deleted
                 "rows.push({id:'h',query:'dup'});"                          # h duplicated -> ambiguous
                 "return L.handoffOutcome(rows,h,{datasetChanged:true})")
    t = T(out)
    assert out["dataset_changed_since_check"] is True
    assert t[("a", "intent_resolution")]["checked_now"] == "trace_changed" and t[("a", "intent_resolution")]["evidence"] == "stale"
    assert t[(7, "intent_resolution")]["checked_now"] == "missing" and t[(7, "intent_resolution")]["label_now"] is None
    assert t[("h", "intent_resolution")]["checked_now"] == "ambiguous" and "no longer unique" in t[("h", "intent_resolution")]["evidence_note"]
    # historical action is preserved, just not current
    assert all(x["action"] == "saved" for x in out["targets"]) and out["evidence_counts"] == {"current": 0, "stale": 4}
    out2, _ = run("save(h,1,4);h.chk.targets[1].row.human_intent_resolution=2;return L.handoffOutcome(rows,h,{})")
    x = T(out2)[(7, "intent_resolution")]
    assert x["evidence"] == "stale" and "label changed" in x["evidence_note"] and x["label_after"]["value"] == 4 and x["label_now"]["value"] == 2


def test_recheck_carry_never_moves_outcomes_onto_changed_targets():
    out, _ = run("save(h,0,5);save(h,1,4);h.skipped.add(h.chk.targets[2].key);"
                 "const old=h.chk;"
                 "old.targets[1].row.response='CHANGED';"          # 7's trace changed -> not a target any more
                 "const neu=await chk();const c=L.handoffCarry(old,h.acts,h.skipped,neu);"
                 "const same=await chk();const c2=L.handoffCarry(neu,c.acts,c.skipped,same);"
                 "return {keys:[...c.acts.keys()],sk:[...c.skipped],dropped:c.dropped,n:neu.targets.length,k2:[...c2.acts.keys()],d2:c2.dropped}")
    assert out["n"] == 3 and out["dropped"] == 1
    assert out["keys"] == [json.dumps(["a", "intent_resolution"], separators=(",", ":"))]
    assert out["sk"] == [json.dumps(["h", "intent_resolution"], separators=(",", ":"))]
    assert out["k2"] == out["keys"] and out["d2"] == 0
    # a replaced row object with an identical trace is a different case object: dropped, never carried
    out3, _ = run("save(h,0,5);const old=h.chk;const i=rows.indexOf(old.targets[0].row);rows[i]=JSON.parse(JSON.stringify(rows[i]));"
                  "const neu=await chk();const c=L.handoffCarry(old,h.acts,h.skipped,neu);return c.dropped")
    assert out3 == 1


def test_second_metric_save_on_same_case_keeps_first_current():
    out, _ = run("save(h,0,5);save(h,3,1);return L.handoffOutcome(rows,h,{})")   # a/IR then a/TA (same row)
    t = T(out)
    assert t[("a", "intent_resolution")]["evidence"] == "current" and t[("a", "task_adherence")]["evidence"] == "current"
    assert out["evidence_counts"] == {"current": 2, "stale": 0}


def test_invalid_entry_id_not_copied_into_export():
    import copy
    from test_relabel_handoff import scenario as sc, pack as pk
    rows, ents = sc(); x = copy.deepcopy(ents); x[5]["fingerprint_now"] = "FREE TEXT LEAK"; x[5]["id"] = "free text id leak"
    out = node(PRE.format(rows=json.dumps(rows), doc=json.dumps(json.dumps(pk(x)))) + "return JSON.stringify(L.handoffOutcome(rows,h,{}))")
    assert "free text id leak" not in out and "FREE TEXT LEAK" not in out
