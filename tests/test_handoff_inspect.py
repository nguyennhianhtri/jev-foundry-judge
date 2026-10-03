"""Inspect a re-label HANDOFF OUTCOME file read-only (t_364db6f4): the first reviewer opens the file the second reviewer
exported and sees each claimed saved/skipped/not-reached target beside the CURRENT label and a re-fingerprinted trace.
Uses the genuine live export from t_5620223e plus labelled edge fixtures. Oracle = python hashlib (test_reviewed_trace.fp)."""
import copy, json, pathlib
from test_reviewed_trace import node, fp

D = pathlib.Path(__file__).resolve().parents[1] / "workspace/deliverables/t_5620223e"
HAVE = (D / "live-1440-outcome-1.json").exists()


def load_rows():
    return [json.loads(l) for l in (D / "live-1440-dataset.jsonl").read_text().splitlines() if l.strip()]


def inspect(rows, text, extra=""):
    return node(f"const rows={json.dumps(rows)};const p=L.parseHandoffOutcomeFile({json.dumps(text)});if(!p.ok)return p;"
                "const H=new Map();const dg=c=>{if(!H.has(c)){H.set(c,undefined)}return H.get(c)};"
                "let r=L.inspectHandoffOutcome(rows,p,dg);for(let i=0;i<3&&!r.ready;i++){for(const c of H.keys())if(H.get(c)===undefined)H.set(c,await L.sha256Hex(c));r=L.inspectHandoffOutcome(rows,p,dg)}"
                "const snap=JSON.stringify(rows);const again=L.inspectHandoffOutcome(rows,p,dg);" + extra +
                "return {ok:true,p,r,untouched:JSON.stringify(rows)===snap&&JSON.stringify(again.saved_reading)===JSON.stringify(r.saved_reading)}")


def by(r):
    return {(t["id"], t["metric"]): t for t in r["targets"]}


def lab(v):
    return {"present": False} if v is None else {"present": True, "value": v}


def tgt(i, row, metric, action, before=None, after=None, fpv=None, evidence="current", src=None):
    t = {"target": i, "id": row["id"], "metric": metric, "source_entries": src or [i], "reviewed_fingerprint": {"scheme": "jfj-trace-v1", "alg": "SHA-256", "digest": fpv or fp(row)},
         "action": action, "checked_now": "current", "label_now": lab(row.get("human_" + metric))}
    if action == "saved":
        t.update(label_changed=before != after, label_before=lab(before), label_after=lab(after), saves=1, action_at="T", skipped_before=False, evidence=evidence, evidence_note=None)
    else:
        t.update(label_changed=None, label_before=None, label_after=None, saves=0, action_at=None, skipped_before=False, evidence=None, evidence_note=None)
    return t


def pack(targets, not_elig=0):
    oc = {"saved_changed": 0, "saved_unchanged": 0, "skipped": 0, "not_reached": 0}; ev = {"current": 0, "stale": 0}; cn = {"current": 0, "trace_changed": 0, "missing": 0, "ambiguous": 0}
    for t in targets:
        oc[("saved_changed" if t["label_changed"] else "saved_unchanged") if t["action"] == "saved" else t["action"]] += 1
        if t["action"] == "saved": ev[t["evidence"]] += 1
        cn[t["checked_now"]] += 1
    el = sum(len(t["source_entries"]) for t in targets)
    return {"kind": "jev-foundry-judge/relabel-handoff-outcome", "version": 1, "app_version": "v1.24.0", "generated_at": "G", "comparison_file": {"name": "c.json"},
            "checked_at": "C", "dataset_changed_since_check": False, "dataset_rows": 5,
            "counts": {"entries_in_file": el + not_elig, "eligible_entries": el, "not_eligible_entries": not_elig, "targets": len(targets),
                       "target_cases": len({json.dumps(t["id"]) for t in targets}), "duplicate_entries_merged": el - len(targets), "outcomes_dropped_at_recheck": 0},
            "outcome_counts": oc, "evidence_counts": ev, "checked_now_counts": cn, "targets": targets,
            "not_eligible_entries": [{"entry": 99 + k, "id": None, "metric": None} for k in range(not_elig)]}


def test_genuine_live_export_matches_its_own_dataset():
    if not HAVE:
        return
    rows = load_rows(); text = (D / "live-1440-outcome-1.json").read_text(); f = json.loads(text)
    out = inspect(rows, text); r = out["r"]; t = by(r)
    assert out["ok"] and out["untouched"] and r["ready"]
    assert r["targets_total"] == len(f["targets"]) == 7 and r["saved_claims"] == 5
    assert r["now_counts"] == {"matched": 7, "missing": 0, "ambiguous": 0, "invalid": 0}
    assert r["trace_counts"]["same"] == 7   # the dataset file is the one BEFORE the pass: traces equal, labels predate the Saves
    # independent: every reviewed fingerprint equals python hashlib over the matching row
    for ft in f["targets"]:
        row = next(x for x in rows if json.dumps(x["id"]) == json.dumps(ft["id"]))
        assert fp(row) == ft["reviewed_fingerprint"]["digest"]
        x = t[(ft["id"], ft["metric"])]
        cur = lab(row.get("human_" + ft["metric"]))
        assert x["label_now"] == cur
        if ft["action"] == "saved":
            want = "consistent" if cur == ft["label_after"] else "label_differs"
            assert x["reading"] == want, (ft["id"], ft["metric"])
        else:
            assert x["reading"] is None and x["label_vs_claim"] == "no_claim"
    # pre-pass dataset: only the unchanged Save (7 IR 3->3) is consistent; changed Saves did not land here
    assert r["saved_reading"]["consistent"] == 1 and r["saved_reading"]["label_differs"] == 4
    assert t[(7, "intent_resolution")]["reading"] == "consistent"


def test_genuine_export_against_post_pass_dataset_all_saves_consistent():
    if not HAVE:
        return
    rows = load_rows(); f = json.loads((D / "live-1440-outcome-1.json").read_text())
    for ft in f["targets"]:   # apply the file's label_now (their dataset at export) to reproduce the first reviewer receiving it
        row = next(x for x in rows if json.dumps(x["id"]) == json.dumps(ft["id"]))
        if ft["label_now"]["present"]: row["human_" + ft["metric"]] = ft["label_now"]["value"]
        else: row.pop("human_" + ft["metric"], None)
    r = inspect(rows, json.dumps(f))["r"]
    stale = [t for t in f["targets"] if t.get("evidence") == "stale"]
    assert r["saved_reading"]["consistent"] == 5 - len(stale) and r["saved_reading"]["label_differs"] == len(stale)
    # if their stale Save's label happens to equal now, it is never plain "consistent"
    st = stale[0]; row = next(x for x in rows if json.dumps(x["id"]) == json.dumps(st["id"])); row["human_" + st["metric"]] = st["label_after"]["value"]
    r2 = inspect(rows, json.dumps(f))["r"]
    assert r2["saved_reading"]["consistent_stale"] == 1 and r2["saved_reading"]["consistent"] == 5 - len(stale)


def test_edge_fixture_saved_skipped_unreached_absent_drift_ambiguous_missing():
    rows = [{"id": "a", "query": "q", "response": "r", "human_intent_resolution": 5},     # saved changed, landed
            {"id": 7, "query": "q7", "response": "r7", "human_intent_resolution": 3},     # saved unchanged, landed
            {"id": "7", "query": "s7", "response": "x", "human_intent_resolution": 1},    # string id: separate case
            {"id": "b", "query": "qb", "response": "rb"},                                 # saved absent->4, but label now absent
            {"id": "t", "query": "qt", "response": "EDITED"},                             # trace drift
            {"id": "d", "query": "d", "response": "d"}, {"id": "d", "query": "d", "response": "d"},
            {"id": "s", "query": "qs", "response": "rs", "human_task_adherence": 2}]
    tr_old = {"id": "t", "query": "qt", "response": "orig"}
    ts = [tgt(1, rows[0], "intent_resolution", "saved", 2, 5),
          tgt(2, rows[1], "intent_resolution", "saved", 3, 3),
          tgt(3, rows[3], "task_adherence", "saved", None, 4),
          tgt(4, tr_old, "intent_resolution", "saved", 1, 2, fpv=fp(tr_old)),
          tgt(5, rows[5], "intent_resolution", "saved", None, 3),
          tgt(6, {"id": "gone", "q": 1}, "intent_resolution", "saved", None, 3),
          tgt(7, rows[7], "task_adherence", "skipped"),
          tgt(8, rows[7], "intent_resolution", "not_reached")]
    out = inspect(rows, json.dumps(pack(ts, 2))); r = out["r"]; t = by(r)
    assert out["ok"] and out["untouched"]
    assert t[("a", "intent_resolution")]["reading"] == "consistent"
    assert t[(7, "intent_resolution")]["reading"] == "consistent" and t[(7, "intent_resolution")]["idx"] == 1   # never the "7" string row
    assert t[("b", "task_adherence")]["reading"] == "label_differs" and t[("b", "task_adherence")]["label_now"] == {"present": False}
    assert t[("t", "intent_resolution")]["trace"] == "changed" and t[("t", "intent_resolution")]["reading"] == "trace_changed"
    assert t[("d", "intent_resolution")]["status"] == "ambiguous" and t[("d", "intent_resolution")]["reading"] == "not_checkable"
    assert t[("gone", "intent_resolution")]["status"] == "missing"
    assert t[("s", "task_adherence")]["reading"] is None and t[("s", "intent_resolution")]["label_vs_claim"] == "no_claim"
    assert r["saved_claims"] == 6 and sum(r["saved_reading"].values()) == 6
    assert r["saved_reading"] == {"consistent": 2, "consistent_stale": 0, "label_differs": 1, "trace_changed": 1, "not_checkable": 2, "pending": 0}
    assert r["now_counts"] == {"matched": 6, "missing": 1, "ambiguous": 1, "invalid": 0}


def test_numeric_label_vs_string_label_not_equal():
    rows = [{"id": "a", "query": "q", "response": "r", "human_intent_resolution": "5"}]
    r = inspect(rows, json.dumps(pack([tgt(1, rows[0], "intent_resolution", "saved", 2, 5)])))["r"]
    assert r["targets"][0]["reading"] == "label_differs"


def test_duplicate_typed_target_in_file_is_invalid_both_times_but_7_and_str7_distinct():
    rows = [{"id": 7, "query": "a", "response": "a"}, {"id": "7", "query": "b", "response": "b"}]
    ts = [tgt(1, rows[0], "intent_resolution", "saved", None, 3), tgt(2, rows[0], "intent_resolution", "skipped"), tgt(3, rows[1], "intent_resolution", "saved", None, 3)]
    r = inspect(rows, json.dumps(pack(ts)))["r"]
    st = [x["status"] for x in r["targets"]]
    assert st == ["invalid", "invalid", "matched"] and r["now_counts"]["invalid"] == 2


def test_malformed_files_refused_whole():
    rows = [{"id": "a", "query": "q", "response": "r"}]
    good = pack([tgt(1, rows[0], "intent_resolution", "saved", None, 3)])
    def bad(mut):
        d = copy.deepcopy(good); mut(d); return inspect(rows, json.dumps(d))
    assert inspect(rows, "nope")["ok"] is False
    assert bad(lambda d: d.update(kind="jev-foundry-judge/label-checklist-outcome"))["ok"] is False
    assert bad(lambda d: d.update(version=2))["ok"] is False
    assert bad(lambda d: d["outcome_counts"].update(saved_changed=0, saved_unchanged=1))["ok"] is False
    assert bad(lambda d: d["counts"].update(targets=2))["ok"] is False
    assert bad(lambda d: d["counts"].update(entries_in_file=5))["ok"] is False
    assert bad(lambda d: d["counts"].update(duplicate_entries_merged=1))["ok"] is False
    assert bad(lambda d: d["evidence_counts"].update(current=0, stale=1))["ok"] is False
    assert bad(lambda d: d["checked_now_counts"].update(current=0, missing=1))["ok"] is False
    assert bad(lambda d: d["counts"].update(target_cases=3))["ok"] is False
    assert bad(lambda d: d["targets"][0].update(action="confirmed"))["ok"] is False
    assert bad(lambda d: d.update(targets=[]))["ok"] is False
    two = pack([tgt(1, rows[0], "intent_resolution", "saved", None, 3), tgt(2, {"id": "z", "q": 1}, "intent_resolution", "skipped")])
    two["targets"][1]["source_entries"] = [1]
    assert inspect(rows, json.dumps(two))["ok"] is False            # same source entry under two targets
    assert bad(lambda d: d["targets"][0].update(source_entries=[9]))["ok"] is False   # outside 1..entries_in_file
    long = copy.deepcopy(good); long["targets"][0]["evidence_note"] = "x" * 5000
    assert len(inspect(rows, json.dumps(long))["p"]["targets"][0]["claimed"]["evidence_note"]) < 600
    # per-target problems -> invalid, not whole-file
    x = bad(lambda d: d["targets"][0].update(label_changed=False))
    assert x["ok"] is False   # counts then mismatch (saved_unchanged 0 declared)
    d = copy.deepcopy(good); d["targets"][0]["label_changed"] = False; d["outcome_counts"].update(saved_changed=0, saved_unchanged=1)
    r = inspect(rows, json.dumps(d))["r"]
    assert r["targets"][0]["status"] == "invalid" and "contradicts" in r["targets"][0]["reason"]


def test_open_current_case_refuses_non_unique_and_is_read_only():
    rows = [{"id": "a", "query": "q", "response": "r", "human_intent_resolution": 4}, {"id": "d", "query": "d", "response": "d"}, {"id": "d", "query": "d", "response": "d"}]
    ts = [tgt(1, rows[0], "intent_resolution", "saved", 2, 4), tgt(2, rows[1], "intent_resolution", "skipped")]
    out = inspect(rows, json.dumps(pack(ts)), "const o1=L.handoffOutcomeCase(rows,p,1),o2=L.handoffOutcomeCase(rows,p,2),o9=L.handoffOutcomeCase(rows,p,9);"
                  "rows[0].response='changed';const fr=L.outcomeCaseFresh(rows,o1);return {o1:{ok:o1.ok,idx:o1.idx,label:o1.label_now,trace:o1.trace},o2,o9,fr};")
    assert out["o1"]["ok"] and out["o1"]["idx"] == 0 and out["o1"]["label"] == {"present": True, "value": 4}
    assert "human_intent_resolution" not in out["o1"]["trace"]
    assert out["o2"]["ok"] is False and out["o2"]["status"] == "ambiguous" and out["o9"]["ok"] is False
    assert out["fr"] is False
