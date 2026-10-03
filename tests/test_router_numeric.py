"""t_f08513c8: price/token inputs are parsed, never coerced to 0 or a hidden default."""
import json, shutil, subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
JS = """
const m = require(process.argv[1]); let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  process.stdout.write(JSON.stringify(JSON.parse(s).map(([raw, bad, kind]) => m.readNum(raw, bad, kind)))); });
"""


@pytest.mark.skipif(not shutil.which("node"), reason="node")
def test_read_num_never_turns_unknown_into_zero_or_default():
    cases = [["", False, "price"], ["  ", False, "price"], ["-1", False, "price"], ["abc", False, "price"], ["", True, "price"],
             ["Infinity", False, "price"], ["0", False, "price"], ["0.05", False, "price"], ["2.5", False, "price"],
             ["", False, "tokens"], ["0", False, "tokens"], ["-5", False, "tokens"], ["1.5", False, "tokens"], ["1e400", False, "tokens"],
             ["400", False, "tokens"]]
    out = json.loads(subprocess.run(["node", "-e", JS, str(ROOT / "app/static/router.js")], input=json.dumps(cases),
                                    capture_output=True, text=True, check=True).stdout)
    ok = [r["ok"] for r in out]
    assert ok == [False] * 6 + [True] * 3 + [False] * 5 + [True]
    assert out[6]["v"] == 0 and out[7]["v"] == 0.05 and out[14]["v"] == 400
    assert "free" in out[0]["msg"] and "negative" in out[2]["msg"]
    js = (ROOT / "app/static/router.js").read_text()
    assert "Math.max(0, +el.value || 0)" not in js and "|| 500" not in js and "|| 400" not in js
