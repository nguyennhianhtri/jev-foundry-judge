"""Create variant (app/static/case_form.js suggestVariantId/draftVariant/buildVariant/validateVariantJSON + app.js
wiring): one new user-authored derivative; source untouched; labels cleared; rich traces deep-copied, JSON-only;
duplicate/identical/invalid refused; provenance survives export/import."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "app" / "static" / "case_form.js"
APP = ROOT / "app" / "static" / "app.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def node(expr, arg):
    code = ("const CF=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
            "const a=JSON.parse(d);process.stdout.write(JSON.stringify((" + expr + ")(CF,a)))})")
    out = subprocess.run(["node", "-e", code, str(JS)], input=json.dumps(arg), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


SIMPLE = {"id": "refund-1", "scenario": "user_authored",
          "query": [{"role": "user", "content": "  Can I return it?\n"}],
          "response": [{"role": "assistant", "content": [{"type": "text", "text": "Yes, 90 days."}]}],
          "context": "Policy: 30 days.", "human_task_adherence": 2, "human_groundedness": 1,
          "x_custom": {"keep": [1, {"a": None}]},
          "note": "user-authored in the browser (not an observed agent trace; no tool calls)", "source": "user-authored"}
RICH = {"id": "tool-01", "scenario": "customer_support",
        "query": [{"role": "system", "content": "sys"}, {"role": "user", "content": "q"}],
        "response": [{"role": "assistant", "content": [{"type": "tool_call", "tool_call_id": "c1", "name": "f", "arguments": {"x": [1, 2]}}]},
                     {"role": "tool", "tool_call_id": "c1", "content": [{"type": "tool_result", "tool_result": {"ok": 1}}]},
                     {"role": "assistant", "content": [{"type": "text", "text": "done"}]}],
        "tool_definitions": [{"name": "f", "parameters": {"type": "object"}}], "human_intent_resolution": 5,
        "generated": True, "vendor_meta": {"trace": "abc"}}


def build(src, form, ids):
    return node("(CF,a)=>{const b=JSON.stringify(a.s);const r=CF.buildVariant(a.s,a.f,a.ids);return {...r,untouched:JSON.stringify(a.s)===b}}",
                {"s": src, "f": form, "ids": ids})


def form(**kw):
    f = {"id": "refund-1-variant", "request": "  Can I return it?\n", "answer": "Yes, within 30 days.",
         "context": "Policy: 30 days.", "labels": {}}
    f.update(kw)
    return f


def test_suggest_id_unique():
    assert node("(CF,a)=>CF.suggestVariantId('a',a)", ["a"]) == "a-variant"
    assert node("(CF,a)=>CF.suggestVariantId('a',a)", ["a", "a-variant", "a-variant-2"]) == "a-variant-3"
    long = node("(CF,a)=>CF.suggestVariantId(a,[])", "x" * 200)
    assert len(long) <= 120


def test_simple_variant_new_row_labels_cleared_provenance_source_untouched():
    r = build(SIMPLE, form(), ["refund-1"])
    assert r["ok"] and r["untouched"]
    v = r["row"]
    assert v["id"] == "refund-1-variant"
    assert v["response"][0]["content"][0]["text"] == "Yes, within 30 days."
    assert v["query"] == SIMPLE["query"]                                    # exact whitespace copied
    assert v["context"] == SIMPLE["context"] and v["x_custom"] == SIMPLE["x_custom"]
    assert not any(k.startswith("human_") for k in v)                        # labels never copied
    assert v["source"] == "user-authored" and v["derived_from"] == {"id": "refund-1", "scenario": "user_authored", "source": "user-authored"}
    assert "not an observed agent run" in v["note"]
    assert list(v)[-3:] == ["note", "source", "derived_from"]


def test_simple_variant_own_labels_kept():
    r = build(SIMPLE, form(labels={"task_adherence": "5", "groundedness": ""}), ["refund-1"])
    assert r["ok"] and r["row"]["human_task_adherence"] == 5 and "human_groundedness" not in r["row"]


def test_refusals_change_nothing():
    for f, ids, key in ((form(id="refund-1"), ["refund-1"], "id"),                 # duplicate of source
                        (form(id="other"), ["refund-1", "other"], "id"),         # duplicate
                        (form(id="  "), ["refund-1"], "id"),
                        (form(answer="Yes, 90 days."), ["refund-1"], "answer"),  # identical content
                        (form(answer="   "), ["refund-1"], "answer"),
                        (form(labels={"task_adherence": "0"}), ["refund-1"], "label_task_adherence")):
        r = build(SIMPLE, f, ids)
        assert r["ok"] is False and key in r["errors"] and r["untouched"], (f, r)


def test_rich_source_json_only_deep_copy():
    assert build(RICH, form(id="t-v"), ["tool-01"])["ok"] is False           # form path refuses rich
    d = node("(CF,a)=>{const b=JSON.stringify(a);const d=CF.draftVariant(a,[a.id]);return {d,untouched:JSON.stringify(a)===b}}", RICH)
    assert d["untouched"]
    v = d["d"]
    for k in ("query", "response", "tool_definitions", "vendor_meta", "scenario"):
        assert v[k] == RICH[k]
    assert v["id"] == "tool-01-variant" and "generated" not in v and "human_intent_resolution" not in v
    assert v["derived_from"] == {"id": "tool-01", "scenario": "customer_support"}
    # unchanged draft is refused (identical content); editing the final text is accepted and not flattened
    assert node("(CF,a)=>CF.validateVariantJSON(a.s,a.v,[a.s.id])", {"s": RICH, "v": v})["ok"] is False
    v2 = json.loads(json.dumps(v)); v2["response"][2]["content"][0]["text"] = "not done"
    ok = node("(CF,a)=>CF.validateVariantJSON(a.s,a.v,[a.s.id])", {"s": RICH, "v": v2})
    assert ok["ok"] and ok["row"]["response"][:2] == RICH["response"][:2] and len(ok["row"]["response"]) == 3
    for bad in ({**v2, "id": "tool-01"}, {**v2, "id": " x "}, {**v2, "human_groundedness": 2.5}, [v2], {**v2, "response": ""}):
        assert node("(CF,a)=>CF.validateVariantJSON(a.s,a.v,[a.s.id])", {"s": RICH, "v": bad})["ok"] is False


def test_variant_export_import_roundtrip():
    """JSONL and CSV export -> app normalize() keeps derived_from/source/labels and the full trace."""
    v = build(SIMPLE, form(labels={"intent_resolution": "4"}), ["refund-1"])["row"]
    src = APP.read_text()
    start = src.index("function normalize(o, n)"); end = src.index("\n}\n", start) + 3
    tstart = src.index("const toJSONL"); tend = src.index("const stamp")
    pstart = src.index("function parseCSV"); pend = src.index("function normalize")
    code = ("const M={intent_resolution:1,task_adherence:1,tool_call_accuracy:1,groundedness:1};" + src[pstart:pend] + src[start:end]
            + src[tstart:tend] + "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const rows=JSON.parse(d);"
            "const j=toJSONL(rows).split('\\n').filter(Boolean).map(l=>normalize(JSON.parse(l),0));"
            "const c=parseCSV(toCSV(rows)).map(normalize);process.stdout.write(JSON.stringify({j,c}))})")
    out = json.loads(subprocess.run(["node", "-e", code], input=json.dumps([SIMPLE, v]), capture_output=True, text=True, check=True).stdout)
    for rows in (out["j"], out["c"]):
        assert rows[1]["derived_from"] == v["derived_from"] and rows[1]["source"] == "user-authored"
        assert rows[1]["response"] == v["response"] and rows[1]["human_intent_resolution"] == 4
        assert "derived_from" not in rows[0]
    # JSONL import keeps every field, incl. unknown extras like x_custom (t_a3a1b16f: trace/unknown fields preserved)
    assert out["j"][1] == v


def test_app_wiring():
    s = APP.read_text()
    assert 'class="ghost fvar"' in s and "openVariant(i)" in s
    assert "S.rows.splice(at + 1, 0, row)" in s                              # exactly one row inserted
    assert "noteEdited(null, row.id)" in s                                   # existing rerun notice
    body = s[s.index("function openVariant"):s.index('$("#loadSample")')]
    assert "S.runRows" not in body.replace("S.runRows.length > 0", "") and "S.results" not in body  # frozen run untouched
    assert "fresh()" in body and "api(" not in body                           # stale guard; no network / auto-eval


def test_json_path_provenance_restamped_and_shapes_checked():
    d = node("(CF,a)=>CF.draftVariant(a,[a.id])", RICH)
    d["response"][2]["content"][0]["text"] = "changed"
    forged = {k: v for k, v in d.items() if k not in ("source", "derived_from", "note")}
    forged["derived_from"] = {"id": "someone-else"}; forged["source"] = "observed"
    r = node("(CF,a)=>CF.validateVariantJSON(a.s,a.v,[a.s.id])", {"s": RICH, "v": forged})
    assert r["ok"] and r["row"]["source"] == "user-authored" and r["row"]["derived_from"]["id"] == "tool-01"
    assert list(r["row"])[-3:] == ["note", "source", "derived_from"]
    for bad in ({**d, "response": 42}, {**d, "response": {}}, {**d, "response": []}, {**d, "query": [1]},
                {**d, "tool_calls": "x"}, {**d, "context": 5}):
        assert node("(CF,a)=>CF.validateVariantJSON(a.s,a.v,[a.s.id])", {"s": RICH, "v": bad})["ok"] is False, bad


def test_variant_of_variant_keeps_root_and_long_ids_clamped():
    v = build(SIMPLE, form(), ["refund-1"])["row"]
    vv = build(v, form(id="refund-1-variant-variant", answer="No."), ["refund-1", v["id"]])["row"]
    assert vv["derived_from"]["id"] == "refund-1-variant" and vv["derived_from"]["root"] == "refund-1"
    ids = ["x" * 120] + ["x" * (120 - len("-variant")) + "-variant"] + [("x" * 120)[: 120 - len(f"-variant-{n}")] + f"-variant-{n}" for n in range(2, 150)]
    s = node("(CF,a)=>CF.suggestVariantId(a[0],a)", ids)
    assert len(s) <= 120 and s not in ids


def test_selection_shift_on_insert():
    s = APP.read_text()
    assert "S.selected = new Set([...S.selected].map(j => j > at ? j + 1 : j))" in s
