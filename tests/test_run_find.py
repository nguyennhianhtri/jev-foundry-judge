"""t_d45415fb: view-only 'Search this run' over the frozen run (findRunCases in app/static/case_find.js) + wiring."""
import json, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
CODE = ("const {findRunCases}=require(process.argv[1]);let d='';process.stdin.on('data',c=>d+=c).on('end',()=>"
        "{const a=JSON.parse(d);const b=JSON.stringify([a.res,a.rr]);"
        "const r=findRunCases(a.res,a.rr,a.q,x=>({req:typeof x.query==='string'?x.query:'',ans:typeof x.response==='string'?x.response:''}));"
        "r.unchanged=JSON.stringify([a.res,a.rr])===b;process.stdout.write(JSON.stringify(r))})")
RR = [{"id": 7, "query": "Refund my order", "response": "Done, refunded"},
      {"id": "7", "query": "Where is my parcel?", "response": "In transit"},
      {"id": "sup-01", "query": "Café opening hours", "response": "Mở cửa lúc 8 giờ"},
      {"id": "sup-01", "query": "Second copy", "response": "dup answer"},
      {"id": "x", "query": "unbound text", "response": ""},
      {"query": "no id row", "response": "absent"}]
RES = [{"id": 7}, {"id": "7"}, {"id": "sup-01"}, {"id": "sup-01"}, {"id": "qqid"}, {}]


def find(q, res=RES, rr=RR):
    out = subprocess.run(["node", "-e", CODE, str(ST / "case_find.js")], input=json.dumps({"res": res, "rr": rr, "q": q}),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_empty_is_inactive_all_rows():
    r = find("  ")
    assert r["active"] is False and r["shown"] == [0, 1, 2, 3, 4, 5] and r["total"] == 6 and r["unchanged"]


def test_id_request_answer_case_insensitive():
    assert find("REFUND")["shown"] == [0]
    assert find("parcel")["shown"] == [1]
    assert find("SUP-01")["shown"] == [2, 3]          # duplicate ids both kept, run order
    assert find("dup answer")["shown"] == [3]        # literal phrase, whole query
    assert find("7")["shown"] == [0, 1]


def test_literal_not_terms_or_regex():
    assert find("my order")["shown"] == [0]
    assert find("order my")["shown"] == []           # not term-split
    assert find(".*")["shown"] == []                 # not a regex


def test_unicode():
    assert find("CAFÉ")["shown"] == [2]
    assert find("mở cửa")["shown"] == [2]


def test_typed_id_binding_and_absent_fields():
    # position 4: frozen row id "x" != result id "y" -> its text is never borrowed
    assert find("unbound")["shown"] == []
    assert find("QQID")["shown"] == [4]                 # matched by its own recorded id only
    # position 5: no id on either -> bound (undefined===undefined), text searchable, no crash
    assert find("absent")["shown"] == [5]
    # 7 number and "7" text: text of row 1 never attributed to row 0
    assert find("transit")["shown"] == [1]


def test_no_match_and_short_runrows():
    r = find("zzqq")
    assert r["active"] and r["shown"] == [] and r["query"] == "zzqq" and r["unchanged"]
    assert find("refund", rr=[])["shown"] == []


def test_wiring_static():
    html = (ST / "index.html").read_text()
    js = (ST / "app.js").read_text()
    assert 'Search this run' in html and 'id="rfind"' in html and "View only" in html
    assert "findRunCases(S.results, S.runRows" in js and "S.rfindRef !== S.results" in js
    assert "shown of ${S.results.length} run rows" in js
