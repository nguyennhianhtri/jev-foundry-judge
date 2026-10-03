"""t_ed766f3f: starter dataset template (app/static/dataset_template.js). Both downloads must go through the app's REAL
Upload parser (parseImport + parseCSV + normalize extracted from app.js) and come back as exactly the intended row,
with every metric applicable under the real Python judge rule. The template is a constant: no dataset/key/run access."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from jev_foundry_judge.evaluators import SPECS, build_state  # noqa: E402

ST = ROOT / "app" / "static"
APP = ST / "app.js"
TPL = ST / "dataset_template.js"
M4 = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def _fns():
    src = APP.read_text()
    take = lambda a, b: src[src.index(a):src.index(b, src.index(a))]
    return "\n".join(['const M = { intent_resolution: 1, task_adherence: 1, tool_call_accuracy: 1, groundedness: 1 };',
                      take("function parseCSV", "function normalize"), take("function normalize", "// Upload -> preview")])


def roundtrip():
    code = _fns() + f"""
const t=require({json.dumps(str(TPL))});const ip=require({json.dumps(str(ST / 'import_preview.js'))});
const j=ip.parseImport('dataset-template.jsonl',t.templateJSONL(),{{parseCSV,normalize}});
const c=ip.parseImport('dataset-template.csv',t.templateCSV(),{{parseCSV,normalize}});
process.stdout.write(JSON.stringify({{row:t.TEMPLATE_ROW,cols:t.TEMPLATE_COLUMNS,jsonl:t.templateJSONL(),csv:t.templateCSV(),j,c}}))"""
    return json.loads(subprocess.run(["node", "-e", code], capture_output=True, text=True, check=True).stdout)


def test_both_formats_roundtrip_exactly_through_real_parser():
    r = roundtrip()
    for p, fmt in ((r["j"], "JSONL"), (r["c"], "CSV")):
        assert p["ok"] and p["format"] == fmt and len(p["rows"]) == 1
        assert p["rows"][0] == r["row"]
        assert list(p["rows"][0]) == r["cols"]          # key order kept too
        assert p["no_id_rows"] == [] and p["odd_id_rows"] == []


def test_every_metric_applicable_under_python_judge_and_labels_valid():
    row = roundtrip()["row"]
    st = build_state(**{k: row.get(k) for k in ("query", "response", "tool_definitions", "tool_calls", "context")})
    for m in M4:
        assert SPECS[m]["requires"](st), m
        assert row["human_" + m] in (1, 2, 3, 4, 5)


def test_template_is_synthetic_constant_with_no_private_access():
    r = roundtrip()
    assert "SYNTHETIC" in r["row"]["query"] and "Synthetic example" in r["row"]["note"]
    src = TPL.read_text()
    for bad in ("S.rows", "S.runRows", "S.key", "fetch(", "api(", "localStorage", "sessionStorage", "X-Jev-Key"):
        assert bad not in src, bad
    assert r["csv"].count("\n") == 2 and r["jsonl"].count("\n") == 1


def test_guide_names_only_fields_the_parser_reads():
    import re
    html = (ST / "index.html").read_text()
    g = html[html.index('id="fmtguide"'):html.index("</details>", html.index('id="fmtguide"'))]
    src = APP.read_text()
    norm = src[src.index("function normalize"):src.index("// Upload -> preview")]
    names = [n for n in re.findall(r"<code>([a-z_]+)</code>", g) if n != "row"]
    assert len(names) >= 12
    for n in names:
        assert f'"{n}"' in norm or f"o.{n}" in norm or n.startswith("human_"), n
