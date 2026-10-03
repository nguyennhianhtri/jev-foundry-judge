"""t_e2d534cf: view-only dataset case search (app/static/case_find.js) + wiring."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const {findCases}=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>"
        "{const a=JSON.parse(d);const before=JSON.stringify(a.items);const r=findCases(a.items,a.q);"
        "r.unchanged=JSON.stringify(a.items)===before;process.stdout.write(JSON.stringify(r))})")
ITEMS = [{"id": 7, "req": "Refund my order", "ans": "Done, refunded"},
         {"id": "7", "req": "Where is my parcel?", "ans": "In transit"},
         {"id": "rag-12", "req": "What is the SLA?", "ans": "99.9% uptime"},
         {"id": None, "req": "", "ans": ""}]


def find(q, items=ITEMS):
    out = subprocess.run(["node", "-e", CODE, str(ST / "case_find.js")], input=json.dumps({"items": items, "q": q}),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_empty_query_shows_all_in_order():
    r = find("   ")
    assert r["active"] is False and r["shown"] == [0, 1, 2, 3] and r["total"] == 4 and r["unchanged"]


def test_matches_id_request_answer_case_insensitive_order_kept():
    assert find("REFUND")["shown"] == [0]
    assert find("rag-12")["shown"] == [2]
    assert find("uptime")["shown"] == [2]
    assert find("7")["shown"] == [0, 1]           # both typed ids match by text, original order
    assert find("my")["shown"] == [0, 1]


def test_all_terms_required_and_no_match():
    assert find("my parcel")["shown"] == [1]
    r = find("zzqq")
    assert r["active"] and r["shown"] == [] and r["total"] == 4 and r["unchanged"]


def test_does_not_search_other_fields():
    items = [{"id": "a", "req": "q", "ans": "r", "human_intent_resolution": 5, "key": "sk-secret"}]
    assert find("secret", items)["shown"] == [] and find("5", items)["shown"] == []


def test_wired_view_only():
    html = (ST / "index.html").read_text(); app = (ST / "app.js").read_text()
    assert 'id="dfind"' in html and "/static/case_find.js" in html and "View only" in html
    body = app.split("function applyFind()")[1].split("function revealRow")[0]
    assert "S.rows" in body and "S.rows =" not in body and "S.rows.splice" not in body and "S.runRows" not in body
    assert "tr.hidden" in body and "Showing" in body and "No case matches" in body
    assert app.count("revealRow(") >= 5


def test_selall_scoped_to_shown_and_undo_reveals():
    app = (ST / "app.js").read_text()
    sel = app.split('$("#selall").onchange')[1].split("};")[0]
    assert "t.hidden" in sel and "S.selected.add(i)" in sel
    assert "undoLastSave(); const tr = at >= 0 && revealRow(at)" in app
