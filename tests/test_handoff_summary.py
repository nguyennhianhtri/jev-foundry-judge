"""t_656eefbb: handoff review summary (.md) over the SAME inspectHandoffOutcome reading (app/static/handoff_summary.js).
Real retained t_5620223e handoff + pre-pass dataset, plus synthetic mixed statuses (7 vs "7", missing, ambiguous,
trace changed, skipped, not reached). The markdown is parsed independently here and reconciled with the raw files."""
import copy, json, re
from test_reviewed_trace import node, fp
from test_handoff_inspect import D, HAVE, load_rows, tgt, pack

ROOT = D.parents[2]
HS, BB = ROOT / "app/static/handoff_summary.js", ROOT / "app/static/bench_brief.js"


def summary(rows, text, name="h.json"):
    return node(f"const HS=require({json.dumps(str(HS))}),BB=require({json.dumps(str(BB))});"
                f"const rows={json.dumps(rows)};const p=L.parseHandoffOutcomeFile({json.dumps(text)});"
                "const H=new Map();const dg=c=>{if(!H.has(c))H.set(c,undefined);return H.get(c)};"
                "let r=L.inspectHandoffOutcome(rows,p,dg);"
                "const pend=HS.buildHandoffSummary({inspect:r,parsed:p},{mdCell:BB.mdCell});"
                "for(let i=0;i<3&&!r.ready;i++){for(const c of H.keys())if(H.get(c)===undefined)H.set(c,await L.sha256Hex(c));r=L.inspectHandoffOutcome(rows,p,dg)}"
                "const snap=JSON.stringify(rows),rs=JSON.stringify(r);"
                f"const meta={{file_name:{json.dumps(name)},file_bytes:{len(text.encode())},file_sha256:await L.sha256Hex({json.dumps(text)}),app_version:'vX',generated_at:'2026-09-28T10:00:00Z',dataset_rows:rows.length}};"
                "const t=HS.buildHandoffSummary({inspect:r,parsed:p,diff:L.handoffDiffTargets(r),meta},{mdCell:BB.mdCell});"
                "const t2=HS.buildHandoffSummary({inspect:r,parsed:p,diff:L.handoffDiffTargets(r),meta},{mdCell:BB.mdCell});"
                "return {pend,t,same:t===t2,untouched:JSON.stringify(rows)===snap&&JSON.stringify(r)===rs}")


def parse_md(t):
    """independent: table rows -> list of dicts; numbers pulled from the named bullet lines"""
    tab = [l for l in t.splitlines() if re.match(r"^\| \d+ \|", l)]
    rows = []
    for l in tab:
        c = [x.strip() for x in re.split(r"(?<!\\)\|", l)[1:-1]]
        rows.append(dict(pos=int(c[0]), id=c[1], metric=c[2], claim=c[3], case=c[4], label_now=c[5], trace=c[6], reading=c[7]))
    return rows


def idtxt(v):
    return f"{v} (number)" if isinstance(v, int) else json.dumps(v) + " (text)"


def lab(row, m):
    k = "human_" + m
    return json.dumps(row[k]) if k in row else "blank"


def test_pending_reading_is_never_summarised():
    rows = [{"id": 7, "query": "a", "response": "b"}]
    o = summary(rows, json.dumps(pack([tgt(1, rows[0], "intent_resolution", "saved", None, 4)])))
    assert o["pend"] is None and o["t"] and o["same"] and o["untouched"]


def test_real_retained_handoff_reconciles_per_target_and_counts():
    if not HAVE:
        return
    rows = load_rows(); text = (D / "live-1440-outcome-1.json").read_text(); f = json.loads(text)
    o = summary(rows, text, "live-1440-outcome-1.json"); t = o["t"]
    assert o["same"] and o["untouched"]
    got = parse_md(t)
    assert [g["pos"] for g in got] == [x["target"] for x in f["targets"]] == list(range(1, 8))
    for g, ft in zip(got, f["targets"]):
        row = [x for x in rows if json.dumps(x["id"]) == json.dumps(ft["id"])]
        assert len(row) == 1; row = row[0]
        assert g["id"] == idtxt(ft["id"]).replace("_", "\\_")
        assert g["claim"].startswith({"saved": "saved", "skipped": "skipped", "not_reached": "not reached"}[ft["action"]])
        assert g["label_now"] == lab(row, ft["metric"]).replace("_", "\\_")
        assert g["trace"] == "same as reviewed" and fp(row) == ft["reviewed_fingerprint"]["digest"]
        if ft["action"] != "saved":
            assert g["reading"] == "no label claim"
        else:
            after = json.dumps(ft["label_after"]["value"]) if ft["label_after"]["present"] else "blank"
            assert (g["reading"] == "label differs now") == (after != lab(row, ft["metric"]))
    # counts: independent tallies equal the stated ones, unknown never shown as 0
    n_diff = sum(g["reading"] == "label differs now" for g in got)
    assert n_diff == 4 and f"- Label differs now: {n_diff}" in t and "- Consistent: 1" in t
    oc = f["outcome_counts"]
    assert f"{oc['saved_changed']} saved, changed · {oc['saved_unchanged']} saved, unchanged · {oc['skipped']} skipped · {oc['not_reached']} not reached (sum 7 of 7)" in t
    assert "7 matched · 0 missing · 0 ambiguous · 0 invalid (sum 7 of 7)" in t and "Sum: 5 of 5 Saves" in t
    assert "File SHA-256: " in t and re.search(r"File SHA-256: [0-9a-f]{64}", t)
    # honesty + privacy
    assert "verified" not in t.lower() and "unsigned claim" in t and "not an independent check" in t
    for r in rows:
        for k in ("query", "response", "context"):
            v = r.get(k)
            if isinstance(v, str) and len(v) > 12:
                assert v not in t, k


def test_mixed_statuses_typed_ids_and_explicit_correction_after_recheck():
    IR, TA = "intent_resolution", "task_adherence"
    rows = [{"id": 7, "query": "a", "response": "b", "human_intent_resolution": 2},
            {"id": "7", "query": "c", "response": "d", "human_intent_resolution": 5},
            {"id": "dup", "query": "e", "response": "f"}, {"id": "dup", "query": "e", "response": "f"},
            {"id": "tc", "query": "g", "response": "h", "human_intent_resolution": 1}]
    old_tc = dict(rows[4]); old_tc["response"] = "OLD"
    T = [tgt(1, rows[0], IR, "saved", 2, 4), tgt(2, rows[1], IR, "saved", 3, 5), tgt(3, rows[2], IR, "saved", None, 3),
         tgt(4, {"id": "gone"}, IR, "saved", None, 3, fpv="0" * 64), tgt(5, old_tc, IR, "saved", 1, 4),
         tgt(6, rows[1], TA, "skipped"), tgt(7, rows[0], TA, "not_reached")]
    text = json.dumps(pack(T))
    o = summary(rows, text); t = o["t"]; g = parse_md(t)
    assert [(x["id"], x["reading"]) for x in g] == [
        ("7 (number)", "label differs now"), ('"7" (text)', "consistent (label now = their saved label, trace same)"),
        ('"dup" (text)', "cannot check now"), ('"gone" (text)', "cannot check now"),
        ('"tc" (text)', "trace changed since, so their Save is about another trace"), ('"7" (text)', "no label claim"), ("7 (number)", "no label claim")]
    assert g[2]["case"].startswith("ambiguous") and g[3]["case"].startswith("missing") and g[4]["trace"] == "CHANGED since reviewed"
    assert g[0]["label_now"] == "2" and g[1]["label_now"] == "5" and g[2]["label_now"] == "not checkable"
    assert "5 matched · 1 missing · 1 ambiguous · 0 invalid (sum 7 of 7)" in t
    assert "1 same · 1 different · 2 not checkable · 2 no label claim" not in t   # label_vs_claim is the existing projection's own tally
    assert "- Consistent: 1\n- Equal but marked stale by them: 0\n- Label differs now: 1\n- Trace changed since: 1\n- Cannot check: 2" in t
    assert "Sum: 5 of 5 Saves; the other 2 targets" in t
    assert "left out: 1 consistent · 1 trace changed · 2 cannot check · 2 skipped / not reached" in t
    # explicit user correction on 7 (number): typed 4 -> re-check reading shows consistent, "7" text untouched, claim not copied
    rows2 = copy.deepcopy(rows); rows2[0]["human_intent_resolution"] = 4
    t2 = summary(rows2, text)["t"]; g2 = parse_md(t2)
    assert g2[0]["reading"].startswith("consistent") and g2[0]["label_now"] == "4" and g2[1]["label_now"] == "5"
    assert "- Label differs now: 0" in t2 and "- Consistent: 2" in t2 and t2 != t


def test_app_wires_same_projection_stale_refusal_and_recheck():
    src = (ROOT / "app/static/app.js").read_text(); html = (ROOT / "app/static/index.html").read_text()
    assert '<script src="/static/handoff_summary.js"></script>' in html
    blk = src[src.index("function hiDataSig"):src.index("function hiSummaryRecheck")]
    for k in ("buildHandoffSummary({ inspect: r, parsed: v.parsed, diff: dt", "inspectHandoffOutcome(S.rows, v.parsed, ocDigest)", "t !== s.text", "Download handoff review summary (.md)", "Re-check against current dataset"):
        assert k in blk, k
    assert "S.rows =" not in blk and "human_" not in blk and "fetch(" not in blk and "verified" not in blk.replace("Not a verification", "")


def test_markdown_injection_and_unknowns_stay_in_their_cells():
    IR = "intent_resolution"
    evil = 'x|y\n`<script>[a](b)*'
    rows = [{"id": evil, "query": "q", "response": "r", "human_intent_resolution": 2}]
    f = pack([tgt(1, rows[0], IR, "saved", 2, 4)]); f["app_version"] = {"not": "text"}; f["generated_at"] = "g|<b>"
    t = summary(rows, json.dumps(f), name="n|<i>.json")["t"]
    tab = [l for l in t.splitlines() if l.startswith("| 1 |")]
    assert len(tab) == 1 and len(re.split(r"(?<!\\)\|", tab[0])) == 10      # 8 cells, nothing split by the id
    assert "<script>" not in t and "<b>" not in t and "<i>" not in t and "[object Object]" not in t
    assert "app unknown (not text)" in t and "(sum 1 of 1)" in t
