"""t_a650cc28: router is the home page, evaluation lives at /evaluate, and no internal names are visible."""
import re
from pathlib import Path
from fastapi.testclient import TestClient
import main

ST = Path(__file__).resolve().parents[1] / "app" / "static"
BANNED = re.compile(r"laya|mac mini|residential|\bTEAM\b|router-gpt|colleague|honest limits", re.I)


def test_routes():
    c = TestClient(main.app)
    home = c.get("/"); assert home.status_code == 200 and 'id="rt-prompt"' in home.text
    ev = c.get("/evaluate"); assert ev.status_code == 200 and 'id="s-key"' in ev.text
    r = c.get("/router", follow_redirects=False); assert r.status_code in (307, 308) and r.headers["location"] == "/"


def test_nav_order_and_single_primary():
    for f in ("router.html", "index.html"):
        h = (ST / f).read_text()
        nav = h[h.index('aria-label="Main"'):]; nav = nav[:nav.index("</nav>")]
        assert [re.sub("<.*?>", "", x) for x in re.findall(r"<a [^>]*>[^<]*</a>", nav)] == ["Route", "Evaluate", "Benchmark"]
    home = (ST / "router.html").read_text()
    assert home.count("sx-primary") == 1


def test_no_internal_names_in_visible_sources():
    for f in ("router.html", "router.js", "index.html", "shell.js", "site.css", "evaluate.css"):
        assert not BANNED.search((ST / f).read_text()), f
    js = (ST / "router.js").read_text()
    for field in ("run_from", "laya_slot", "b.limits", "b.summary", "m.deployment)"):
        assert field not in js, field


def test_header_offset_and_no_glow():
    css = (ST / "site.css").read_text()
    assert "scroll-margin-top" in css and "radial-gradient" not in css and "box-shadow:var(--shadow)" not in css
