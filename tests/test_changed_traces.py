"""Changed-traces review projection (t_aba99eae): every entry in exactly one bucket, hash-only changed traces never
field-comparable, queue = all changed in file order, report carries every diff item exactly with null/absent/type kept."""
import copy, json
from test_reviewed_trace import ROW, entry, node, pack, proj, fp


def ct(rows, entries):
    return node(f"const rows={json.dumps(rows)};const p=L.parseOutcomeFile({json.dumps(json.dumps(pack(entries)))});"
                "const H=new Map();for(const r of rows)H.set(L.traceProjection(r),await L.sha256Hex(L.traceProjection(r)));"
                "for(const e of p.entries){const s=e.claimed.trace_snap;if(s&&s.canon)H.set(s.canon,await L.sha256Hex(s.canon));}"
                "const c=L.changedTraces(L.inspectOutcome(rows,p,c=>H.get(c)));return [c,L.changedTracesReport(c,{frozenAt:'F',file:'f.json',datasetRows:rows.length})]")


def mk(i, **kw):
    r = copy.deepcopy(ROW); r["id"] = i; r.update(kw); return r


def test_buckets_counts_queue_and_report():
    a, b, c, d, e = mk("a"), mk("b"), mk("c"), mk("d"), mk("e")
    old = {k: copy.deepcopy(v) for k, v in dict(a=a, b=b, c=c, d=d, e=e).items()}
    a2 = copy.deepcopy(a); a2["context"] = None; a2["response"][0]["content"][0]["arguments"]["n"] = 3
    b2 = copy.deepcopy(b); b2["query"] = "q2"                               # changed, no snapshot -> hash-only
    c2 = json.loads(json.dumps({k: c[k] for k in reversed(list(c))})); c2["human_intent_resolution"] = 1   # key order + relabel
    e2 = copy.deepcopy(e); e2["meta"] = {}                                  # changed, tampered snapshot -> hash-only
    rows = [a2, b2, c2, d, e2, mk("dup"), mk("dup")]
    tam = entry(old["e"]); tam["reviewed_trace"]["trace"]["context"] = "forged"
    ents = [entry(old["a"]), entry(old["b"], snap=False), entry(old["c"]), entry(old["d"]), tam,
            entry(mk("dup")), entry(mk("gone")), dict(entry(old["d"], snap=False), trace_fingerprint=None)]
    for i, x in enumerate(ents): x["entry"] = i + 1
    live, rep = ct(rows, ents)
    assert live["ready"] and live["counts"] == {"entries_total": 8, "changed": 3, "field_comparable": 1, "hash_only": 2, "unchanged": 2, "unavailable": 3}
    assert live["queue"] == [1, 2, 5]
    buckets = [x["bucket"] for x in live["entries"]]
    assert buckets == ["field_comparable", "hash_only", "unchanged", "unchanged", "hash_only", "unavailable", "unavailable", "unavailable"]
    assert live["unavailable_by_reason"] == {"no single current case with that exact ID": 2, "no fingerprint in file": 1}
    ch = rep["changed_entries"]
    assert [x["entry"] for x in ch] == [1, 2, 5] and ch[1]["comparison"] == "hash_only" and "diff" not in ch[1] and "diff" not in ch[2]
    assert ch[2]["reason"] == "the included trace does not match its own fingerprint"
    got = {x["path"]: x for x in ch[0]["diff"]}
    assert got["context"] == {"path": "context", "kind": "changed", "before": "c", "after": None}
    assert got["response[0].content[0].arguments.n"]["before"] == 2 and got["response[0].content[0].arguments.n"]["after"] == 3
    assert ch[0]["fields_changed"] == 2 and ch[0]["diff_capped"] is False and ch[0]["current_row"] == 1
    assert rep["counts"] == live["counts"] and len(rep["changed_entries"]) + len(rep["other_entries"]) == 8
    assert rep["kind"] == "jev-foundry-judge/changed-traces-comparison" and "CASE TEXT" in rep["contains"]


def test_removed_field_has_no_after_key_and_no_results():
    a = mk("a"); a2 = copy.deepcopy(a); del a2["meta"]
    live, rep = ct([a2], [entry(a)])
    d = rep["changed_entries"][0]["diff"][0]
    assert d == {"path": "meta", "kind": "removed", "before": {"x": None}}
    live, rep = ct([a], [entry(a)])
    assert live["queue"] == [] and live["counts"]["changed"] == 0 and rep["changed_entries"] == []


def test_typed_id_9_vs_string_is_not_bound():
    r = mk(9); e = entry(r); e["id"] = "9"
    live, _ = ct([dict(r, query="x")], [e])
    assert live["queue"] == [] and live["entries"][0]["bucket"] == "unavailable"
