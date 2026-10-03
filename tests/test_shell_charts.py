"""t_ede6a24b: three-section shell + inline-SVG charts. Charts are pure projections of a /api/summary object
(never invent numbers); the shell wraps go() without touching key/data/runs."""
import json
import subprocess
from html.parser import HTMLParser
from pathlib import Path

R = Path(__file__).resolve().parents[1]
ST = R / "app" / "static"


def js(expr):
    code = f"const J=require({json.dumps(str(ST / 'charts.js'))});const s=require({json.dumps(str(ST / 'bench/summary.json'))});console.log(JSON.stringify({expr}))"
    return json.loads(subprocess.check_output(["node", "-e", code]))


def test_published_summary_matches_benchmark_results():
    assert json.loads((ST / "bench/summary.json").read_text()) == json.loads((R / "benchmark/results/summary.json").read_text())


def test_headline_uses_recorded_numbers_only():
    h = js("J.headline(s)")
    assert h.count('class="hl-stat"') == 4
    for t in ("86%", "296 ms", "$0.017", "0.84", "72%", "$1.97", "0.49"):
        assert t in h, t


def test_full_has_four_charts_and_hides_missing_llm():
    f = js("J.full(s)")
    assert f.count('class="cx-card"') == 4 and "LLM judge" in f
    j = js("J.full({...s, llm: {evaluations: 0}})")
    assert "Foundry built-in LLM judge" not in j and "c-llm" not in j.replace('class="c-llm"', "")


def test_missing_values_render_dash_never_zero():
    x = js("J.headline({rows:0,jev:{},llm:{},overall:{}})")
    assert "—" in x and ">0%<" not in x


class T(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids = {}

    def handle_starttag(self, tag, a):
        a = dict(a)
        if a.get("id"): self.ids[a["id"]] = (tag, a)


def test_shell_sections_and_single_primary_on_first_screen():
    html = (ST / "index.html").read_text(); t = T(); t.feed(html)
    for i in ("secnav", "s-route", "s-bench", "benchCharts", "dashCharts", "heroStats", "advExport", "steps"):
        assert i in t.ids, i
    hero = html[html.index('<section id="s-key"'):html.index("<!-- DATA -->")]
    assert hero.count('class="primary"') + hero.count('primary big') == 1
    assert html.index("charts.js") < html.index("/static/app.js\"") < html.index("shell.js")


def test_shell_never_touches_key_or_data():
    s = (ST / "shell.js").read_text()
    for bad in ("S.key", "S.rows", "S.results", "/api/judge", "/api/verify", "localStorage", "sessionStorage"):
        assert bad not in s, bad


def test_iter2_disclosure_keeps_ids_and_verdict_is_real():
    """t_3922959e: old dashboard cards live in a collapsed Advanced drawer, all ids kept; hero verdict = real sup-03 result."""
    import json
    root = Path(__file__).resolve().parents[1]
    html = (root / "app" / "static" / "index.html").read_text()
    adv = html[html.index('id="dashAdv"'):]
    adv = adv[:adv.index("</details>")]
    for i in ("metricBars", "agree", "distCard", "dist"):
        assert f'id="{i}"' in adv
    assert '<details class="card advdrawer" id="dashAdv">' in html  # collapsed
    for i in ("rfilter", "rfindbar", "rtable", "failBar", "disBar", "detail", "coverage", "labelq", "fmtguide"):
        assert html.count(f'id="{i}"') == 1
    assert 'id="coverage" hidden' in html and 'id="coverage" open' not in html
    r = next(json.loads(l) for l in (root / "benchmark" / "results" / "results.jsonl").open() if json.loads(l)["id"] == "sup-03")
    d = r["jev_detail"]["task_adherence"]
    assert r["jev"]["task_adherence"] == 2.0 and d["result"] == "fail" and r["human"]["task_adherence"] == 1
    bad = {c["check"]: c["p_yes"] for c in d["checks"] if c.get("good") is False}
    hero = html[html.index('id="heroVerdict"'):html.index("</figure>")]
    for k, v in bad.items():
        assert k.capitalize() in hero and f"p = {v:.2f}" in hero
    assert "primary" not in hero  # still one primary CTA on the hero
