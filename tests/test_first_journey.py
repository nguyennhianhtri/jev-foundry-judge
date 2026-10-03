"""t_e7a39fe0: the Dataset step keeps intake primary and groups the four file-review tools in a collapsed
Advanced review disclosure; the Run step's next action is navigation only (it never calls runBtn)."""
from html.parser import HTMLParser
from pathlib import Path

STATIC = Path(__file__).resolve().parents[1] / "app" / "static"
ADV_INPUTS = {"chkfile", "ocfile", "hofile", "hifile"}
PRIMARY = {"sample", "loadSample", "addCase", "upload", "genBtn", "clearBtn"}
VIEWS = {"chklist", "ocview", "hoview", "hiview"}


class Tree(HTMLParser):
    VOID = {"input", "meta", "link", "br", "img", "hr"}

    def __init__(self):
        super().__init__()
        self.stack, self.where = [], {}

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("id"):
            self.where[a["id"]] = ([s[1].get("id") for s in self.stack], tag, a)
        if tag not in self.VOID:
            self.stack.append((tag, a))

    def handle_endtag(self, tag):
        while self.stack:
            if self.stack.pop()[0] == tag:
                break


def tree():
    t = Tree()
    t.feed((STATIC / "index.html").read_text())
    return t.where


def test_advanced_review_groups_only_the_four_file_tools():
    w = tree()
    assert w["advrev"][1] == "details" and "open" not in w["advrev"][2]
    for i in ADV_INPUTS:
        assert "advrev" in w[i][0], i
    for i in PRIMARY:
        assert "advrev" not in w[i][0], i
    # the review views stay outside the disclosure, so collapsing it never hides or resets an open view
    for v in VIEWS:
        assert "advrev" not in w[v][0], v
    assert "advActive" in w and "advrev" in w["advActive"][0]


def test_indicator_tracks_every_review_view_and_next_actions_are_navigation_only():
    js = (STATIC / "app.js").read_text()
    for v in VIEWS:
        assert f'["#{v}", ' in js
    start = js.index("function renderDataNext")
    block = js[start:js.index("// ---------- run", start)] + js[js.index("function renderRun() {"):js.index('$("#runBtn").onclick')]
    assert "runBtn" not in block and "api(" not in block and "localStorage" not in block and "S.rows =" not in block
    assert '$("#goRun").onclick = () => go("run")' in js
