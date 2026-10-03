"""t_29349a80: Open benchmark package = read-only offline review of a package written by bench_package.js.
Validates kind/version/size/shape + declared counts/ids/row membership BEFORE rendering; rebuilds the comparison with
the SAME buildBenchCompare/buildBenchBrief projections priced ONLY from the file's recorded config and checks that it
reproduces the stored brief byte-for-byte. Real packages: t_e99fa8ea live BYO-key run + labelled real47 REPLAY."""
import copy
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ST = ROOT / "app" / "static"
DL = ROOT / "tests" / "fixtures" / "pkg"  # retained real packages from t_e99fa8ea (no key)
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")

JS = """const c=require(process.argv[1]),b=require(process.argv[2]),o=require(process.argv[3]);let d='';
process.stdin.on('data',x=>d+=x).on('end',()=>{const a=JSON.parse(d);const r=o.openBenchPackage(a.text,{...c,...b});
if(r.ok){delete r.rows;delete r.flat;delete r.results;}process.stdout.write(JSON.stringify(r))})"""


def open_(text):
    out = subprocess.run(["node", "-e", JS, str(ST / "bench_compare.js"), str(ST / "bench_brief.js"), str(ST / "bench_package_open.js")],
                         input=json.dumps({"text": text}), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def real(name):
    p = DL / name
    if not p.exists():
        pytest.skip("retained real packages not present in this tree")
    return p.read_text()


def dump(pkg):
    return json.dumps(pkg, indent=2) + "\n"


@pytest.mark.parametrize("name", ["key-1440-before-package.json", "key-390-after-package.json",
                                  "replay-1440-before-package.json", "replay-390-after-package.json"])
def test_real_packages_open_and_reproduce_stored_brief(name):
    t = real(name)
    o = open_(t)
    assert o["ok"] and o["briefReproduced"] is True
    pkg = json.loads(t)
    res = [json.loads(x) for x in pkg["files"]["results.jsonl"].splitlines()]
    assert o["counts"]["rows"] == len(res) == pkg["manifest"]["run"]["rows"]
    # displayed numbers recomputed from raw contained rows
    assert o["compare"]["jev"]["known_usd"] == pytest.approx(sum(r["jev_usd"] for r in res))
    rc = pkg["manifest"]["run"]["recorded_config"]
    if rc is None:  # labelled replay: prices stay unknown, never borrowed
        assert o["pricing"]["source"] == "not_recorded" and o["pricing"]["jev_usd_per_mtok_input"] is None
    else:
        assert o["pricing"]["jev_usd_per_mtok_input"] == rc["jev_usd_per_mtok_input"]


def test_recorded_price_drift_is_ignored_only_file_prices_apply():
    # the key run was exported before AND after the host prices were changed; opened view is identical
    a, b = open_(real("key-1440-before-package.json")), open_(real("key-1440-after-package.json"))
    assert a["compare"] == b["compare"] and a["pricing"] == b["pricing"]
    # editing the recorded prices in the file changes pricing text -> stored brief no longer reproduced
    pkg = json.loads(real("key-1440-before-package.json"))
    pkg["manifest"]["run"]["recorded_config"]["jev_usd_per_mtok_input"] = 0.5
    o = open_(dump(pkg))
    assert o["ok"] and o["pricing"]["jev_usd_per_mtok_input"] == 0.5 and o["briefReproduced"] is False and o["briefDiffLines"] >= 1


def mutate(fn):
    pkg = json.loads(real("key-1440-before-package.json"))
    fn(pkg)
    return dump(pkg)


def _fix_bytes(pkg, file, comp):
    pkg["manifest"]["components"][comp]["bytes"] = len(pkg["files"][file].encode())


def _drop_row(p):
    p["files"]["results.jsonl"] = "".join(p["files"]["results.jsonl"].splitlines(True)[:-1]); _fix_bytes(p, "results.jsonl", "results")


def _swap_result_id(p):
    L = p["files"]["results.jsonl"].splitlines(True); r = json.loads(L[0]); r["id"] = "rag-99"
    L[0] = json.dumps(r) + "\n"; p["files"]["results.jsonl"] = "".join(L); _fix_bytes(p, "results.jsonl", "results")


def _typed_id(p):
    p["manifest"]["run"]["ids_in_order"][0] = 1


@pytest.mark.parametrize("fn,frag", [
    (lambda p: p["manifest"].update(format="other"), "kind"),
    (lambda p: p["manifest"].update(format_version=2), "version"),
    (lambda p: p["files"].update({"extra.txt": "x"}), "files must be exactly"),
    (lambda p: p["manifest"]["components"]["results"].update(bytes=1), "declared size"),
    (lambda p: p["manifest"]["run"].update(rows=8), "declares 8 rows"),
    (_drop_row, "results"),
    (_swap_result_id, "different ID"),
    (_typed_id, "IDs in order"),
    (lambda p: p["manifest"]["run"].update(rows_with_error=3), "failed rows"),
    (lambda p: p["manifest"]["run"].update(recorded_config="yes"), "recorded configuration"),
    (lambda p: p["manifest"]["run"]["recorded_config"].update(metrics="x"), "recorded metrics"),
    (lambda p: p["manifest"]["run"].update(baseline_label={"a": 1}), "baseline_label"),
    (lambda p: p["manifest"]["run"].update(wall_s={"toFixed": 1}), "wall_s"),
])
def test_inconsistent_packages_refuse(fn, frag):
    o = open_(mutate(fn))
    assert o["ok"] is False and frag in o["error"]


@pytest.mark.parametrize("text", ["", "not json", "[]", "{}", json.dumps({"manifest": {}, "files": {}})])
def test_malformed_refuse(text):
    assert open_(text)["ok"] is False


def test_oversize_refused():
    o = open_(" " * 8000001)
    assert o["ok"] is False and "MB" in o["error"]


def test_missing_config_stays_unknown():
    o = open_(mutate(lambda p: p["manifest"]["run"].update(recorded_config=None)))
    assert o["ok"] and o["pricing"]["source"] == "not_recorded" and o["briefReproduced"] is False


def test_ui_is_read_only_and_local():
    js = (ST / "app.js").read_text()
    seg = js.split("// ---------- open a benchmark package")[1].split("// ---------- boot")[0]
    seg = "\n".join(l for l in seg.splitlines() if not l.lstrip().startswith("//"))
    for bad in ["api(", "fetch(", "localStorage", "sessionStorage", "S.rows =", "S.runRows =", "S.results =",
                "S.summary =", "S.runCfg =", "S.key", "innerHTML = o.brief"]:
        assert bad not in seg, bad
    assert "$(\"#pvBrief\").textContent" in seg and "Unverified file evidence" in seg
