"""t_8a886e42: focused pass over EXACTLY the "label differs now" targets of inspectHandoffOutcome (no new matching).
Uses the genuine retained t_5620223e live export + its pre-pass dataset, plus synthetic typed-id edge fixtures."""
import copy, json
from test_reviewed_trace import node
from test_handoff_inspect import D, HAVE, load_rows, tgt, pack, inspect


def diff(rows, text):
    return node(f"const rows={json.dumps(rows)};const p=L.parseHandoffOutcomeFile({json.dumps(text)});"
                "const H=new Map();const dg=c=>{if(!H.has(c))H.set(c,undefined);return H.get(c)};"
                "let r=L.inspectHandoffOutcome(rows,p,dg);const pend=L.handoffDiffTargets(r);"
                "for(let i=0;i<3&&!r.ready;i++){for(const c of H.keys())if(H.get(c)===undefined)H.set(c,await L.sha256Hex(c));r=L.inspectHandoffOutcome(rows,p,dg)}"
                "const snap=JSON.stringify(rows);const d=L.handoffDiffTargets(r);return {pend,d,r,untouched:JSON.stringify(rows)===snap}")


def test_real_retained_export_lists_exactly_the_label_differs_in_file_order():
    if not HAVE:
        return
    rows = load_rows(); text = (D / "live-1440-outcome-1.json").read_text(); f = json.loads(text)
    o = diff(rows, text); d = o["d"]
    assert o["pend"] == {"ready": False, "list": [], "excluded": {}}   # never a list before fingerprints resolve
    want = [(t["target"], t["id"], t["metric"]) for t in f["targets"]
            if t["action"] == "saved" and json.dumps(t["label_after"]) != json.dumps(
                {"present": True, "value": next(x for x in rows if json.dumps(x["id"]) == json.dumps(t["id"])).get("human_" + t["metric"])}
                if "human_" + t["metric"] in next(x for x in rows if json.dumps(x["id"]) == json.dumps(t["id"])) else {"present": False})]
    got = [(x["pos"], x["id"], x["metric"]) for x in d["list"]]
    assert got == want and len(got) == 4 == o["r"]["saved_reading"]["label_differs"]
    assert got == sorted(got, key=lambda g: g[0])
    assert d["excluded"] == {"consistent": 1, "consistent_stale": 0, "trace_changed": 0, "not_checkable": 0, "no_save_claim": 2}
    assert o["untouched"]


def test_typed_ids_ambiguous_missing_trace_changed_excluded_with_reasons():
    rows = [{"id": 7, "query": "a", "response": "b", "human_intent_resolution": 2},
            {"id": "7", "query": "c", "response": "d", "human_intent_resolution": 5},
            {"id": "dup", "query": "e", "response": "f"}, {"id": "dup", "query": "e", "response": "f"},
            {"id": "tc", "query": "g", "response": "h", "human_intent_resolution": 1}]
    IR = "intent_resolution"
    orig_tc = dict(rows[4]); orig_tc["response"] = "OLD"
    t = [tgt(1, rows[0], IR, "saved", 2, 4),          # label differs (7 now 2, they saved 4)
         tgt(2, rows[1], IR, "saved", 3, 5),          # consistent ("7" now 5)
         tgt(3, rows[2], IR, "saved", None, 3),       # ambiguous -> not_checkable
         tgt(4, {"id": "gone"}, IR, "saved", None, 3, fpv="0" * 64),   # missing
         tgt(5, orig_tc, IR, "saved", 1, 4),          # trace changed since reviewed
         tgt(6, rows[1], "task_adherence", "skipped")]
    o = diff(rows, json.dumps(pack(t)))
    assert [(x["pos"], x["id"]) for x in o["d"]["list"]] == [(1, 7)]    # 7 only; "7" is consistent
    assert o["d"]["excluded"] == {"consistent": 1, "consistent_stale": 0, "trace_changed": 1, "not_checkable": 2, "no_save_claim": 1}
    assert o["untouched"]


def test_app_wires_pass_through_existing_label_dialog_only():
    src = (D.parents[2] / "app/static/app.js").read_text()
    for k in ("handoffDiffTargets(r)", "hiDiffFresh", "Label difference ${dp.i + 1} of ${n}", "openLabelPass(S.rows.indexOf(t.row), { metric: t.metric, row: t.row, banner",
              "← Back to handoff outcome", "ck?.onClose?.()"):
        assert k in src, k
    # the pass never writes labels itself: no human_ assignment inside the hiDiff block
    blk = src[src.index("function hiDiffFresh"):src.index("var HIC = null;")]
    assert "human_\" + t.metric] =" not in blk and "S.rows =" not in blk and "fetch(" not in blk
