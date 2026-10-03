"""Read-only inspection of a checklist-outcome file (parseOutcomeFile + inspectOutcome)."""
import json, shutil, subprocess
from pathlib import Path
import pytest

JS = Path(__file__).resolve().parents[1] / "app" / "static" / "label_coverage.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
P = lambda v: {"present": True, "value": v}
A = {"present": False}


def E(id, m, out, st, lbl=None, cur=None, ev=None):
    return {"entry": 1, "id": id, "metric": m, "file_before": A, "file_after": P(3), "current_status": st, "current_label": cur,
            "outcome": out, "outcome_label": lbl, "evidence": ev, "label_changed_by_save": True if out == "saved" else None}


def pack(entries):
    oc = {k: 0 for k in ["saved", "confirmed", "skipped", "not_reviewed"]}
    sc = {k: 0 for k in ["matched", "drifted", "missing", "ambiguous", "invalid"]}
    ev = {"current": 0, "stale": 0}
    for e in entries:
        oc[e["outcome"]] += 1; sc[e["current_status"]] += 1
        if e["evidence"]: ev[e["evidence"]] += 1
    return {"kind": "jev-foundry-judge/label-checklist-outcome", "version": 1, "app_version": "v1.16", "entries_total": len(entries),
            "outcome_counts": oc, "status_counts": sc, "evidence_counts": ev, "entries": entries}


GOOD = [E("a", "intent_resolution", "saved", "matched", P(3), P(3), "current"),
        E("b", "intent_resolution", "confirmed", "matched", P(3), P(3), "current"),
        E("gone", "task_adherence", "saved", "matched", P(3), P(3), "current"),
        E("d", "task_adherence", "confirmed", "matched", A, A, "current"),
        E(7, "task_adherence", "confirmed", "matched", P(5), P(5), "current"),
        E("s", "intent_resolution", "skipped", "drifted", None, A),
        E(None, None, "not_reviewed", "invalid")]
ROWS = ("[{id:'a',query:'q',response:'x',human_intent_resolution:3},{id:'b',query:'q',response:'x',human_intent_resolution:2},"
        "{id:'d',query:'q',response:'1'},{id:'d',query:'q',response:'2'},{id:'7',query:'q',response:'x',human_task_adherence:5},"
        "{id:'s',query:'q',response:'x'}]")


def node(body):
    code = f"const L=require(process.argv[1]);const rows={ROWS};const out=(()=>{{{body}}})();process.stdout.write(JSON.stringify(out))"
    return json.loads(subprocess.run(["node", "-e", code, str(JS)], capture_output=True, text=True, check=True).stdout)


def parse(obj):
    return node(f"return L.parseOutcomeFile({json.dumps(obj if isinstance(obj, str) else json.dumps(obj))})")


def test_inspect_matches_drift_missing_ambiguous_type_strict_and_read_only():
    o = node(f"const p=L.parseOutcomeFile({json.dumps(json.dumps(pack(GOOD)))});const s=JSON.stringify(rows);"
             "const r=L.inspectOutcome(rows,p);r.same_rows=JSON.stringify(rows)===s;r.cc=p.claimed_counts;return r")
    assert o["same_rows"]
    assert o["cc"]["outcome"] == {"saved": 2, "confirmed": 3, "skipped": 1, "not_reviewed": 1}
    e = o["entries"]
    assert [x["now"]["status"] for x in e] == ["matched", "drifted", "missing", "ambiguous", "missing", "drifted", "invalid"]
    assert [x["claimed_vs_now"] for x in e] == ["same", "different", "not_checkable", "not_checkable", "not_checkable", "no_claim", "no_claim"]
    assert e[4]["now"]["reason"].startswith("no case with this exact id")   # numeric 7 != "7"
    assert e[0]["claimed"]["status_at_export"] == "matched" and e[1]["claimed"]["outcome"] == "confirmed"
    assert o["now_counts"] == {"matched": 1, "drifted": 2, "missing": 2, "ambiguous": 1, "invalid": 1}
    assert sum(o["now_counts"].values()) == o["entries_total"] == 7 == sum(o["claimed_label_vs_now"].values())


def test_absent_vs_number_claim():
    o = node(f"const p=L.parseOutcomeFile({json.dumps(json.dumps(pack([E('s','intent_resolution','confirmed','matched',A,A,'current')])))});"
             "rows[5].human_intent_resolution=0;return L.inspectOutcome(rows,p)")
    assert o["entries"][0]["claimed_vs_now"] == "different"


@pytest.mark.parametrize("mut,err", [
    (lambda p: p.update(kind="x"), "wrong kind"),
    (lambda p: p.update(version=2), "unsupported version"),
    (lambda p: p.update(entries=[]), "missing or empty"),
    (lambda p: p.update(entries_total=99), "entries_total"),
    (lambda p: p["outcome_counts"].update(saved=5), "outcome_counts.saved"),
    (lambda p: p["status_counts"].update(matched="5"), "malformed"),
    (lambda p: p["entries"][0].update(outcome="approved"), "unknown outcome"),
    (lambda p: p["evidence_counts"].update(stale=3), "evidence_counts"),
])
def test_whole_file_rejections(mut, err):
    p = pack([dict(x) for x in GOOD]); mut(p)
    r = parse(p)
    assert r["ok"] is False and err in r["error"]


def test_not_json_and_oversize():
    assert "not a JSON" in parse("{nope")["error"]
    assert "too large" in node("return L.parseOutcomeFile(' '.repeat(L.MAX_OUTCOME_BYTES+1))")["error"]


def test_per_entry_shape_problems_become_invalid():
    bad = [E("a", "intent_resolution", "saved", "matched", None, P(3), "current"),
           E("a", "intent_resolution", "skipped", "matched", P(3)),
           E("a", "bogus", "not_reviewed", "matched"),
           E("a", "intent_resolution", "confirmed", "matched", {"present": True}, P(3), "current")]
    r = parse(pack(bad))
    assert r["ok"] and [x["status"] for x in r["entries"]] == ["invalid"] * 4


def test_outcome_case_opens_only_unique_exact_matches_and_detects_staleness():
    o = node(f"const p=L.parseOutcomeFile({json.dumps(json.dumps(pack(GOOD)))});const s=JSON.stringify(rows);"
             "const r=[1,2,3,4,5,6,7,99].map(n=>{const c=L.outcomeCase(rows,p,n);return c.ok?{ok:true,idx:c.idx,id:c.id,st:c.status,lbl:c.label_now,ap:c.applicable,tr:c.trace,cl:c.claimed.outcome}:{ok:false,st:c.status||null}});"
             "const a=L.outcomeCase(rows,p,1);const f0=L.outcomeCaseFresh(rows,a);"
             "const r2=JSON.parse(JSON.stringify(rows));const f1=L.outcomeCaseFresh(r2,a);"   # replaced dataset (new objects)
             "rows[0].response='edited';const f2=L.outcomeCaseFresh(rows,a);rows[0].response='x';const f3=L.outcomeCaseFresh(rows,a);"
             "rows.push({id:'a'});const f4=L.outcomeCaseFresh(rows,a);rows.pop();"
             "return {r,f:[f0,f1,f2,f3,f4],same:JSON.stringify(rows)===s}")
    r = o["r"]
    assert r[0] == {"ok": True, "idx": 0, "id": "a", "st": "matched", "lbl": {"present": True, "value": 3}, "ap": True,
                    "tr": {"id": "a", "query": "q", "response": "x"}, "cl": "saved"}   # trace excludes human_* labels
    assert r[1]["ok"] and r[1]["idx"] == 1 and r[1]["lbl"] == {"present": True, "value": 2}
    assert [x["ok"] for x in r] == [True, True, False, False, False, True, False, False]
    assert [x["st"] for x in r if not x["ok"]] == ["missing", "ambiguous", "missing", "invalid", None]   # 7 != "7"
    assert o["f"] == [True, False, False, True, False] and o["same"]
