"""t_d0deefc7: returning to a step with an open Prepare preview re-derives it (no stale before->after counts after a
Dataset selection/row edit). Static wiring check on app.js go(); behaviour is exercised live by the deliverable journey."""
import re
from pathlib import Path

ST = Path(__file__).resolve().parents[1] / "app" / "static"
S = (ST / "app.js").read_text()
GO = S[S.index("function go(step) {"):S.index("$$(\".steps button\").forEach(b => b.onclick")]


def test_dash_return_rerenders_every_open_prepare_preview():
    m = re.search(r'if \(step === "dash" && \(([^)]*)\)\) renderRows\(\);', GO)
    assert m, GO
    for k in ("S.rfp", "S.disPrep", "S.failPrep", "S.slowPrep"):
        assert k in m.group(1)


def test_export_return_rerenders_open_decrease_prepare():
    assert 'if (step === "export" && S.pv?.rc?.prep) renderRunCompare();' in GO


def test_go_makes_no_calls_and_never_touches_selection():
    assert "api(" not in GO and "fetch(" not in GO and "S.selected" not in GO


def test_each_renderer_recomputes_from_prepareRerun_on_sig_change():
    # the refreshed renderers all recompute through the same prepSig check (no separate store)
    for pat in (r"S\.rfp && S\.rfp\.sig !== prepSig\(\)\) S\.rfp = \{ \.\.\.S\.rfp, r: rfpCompute",
                r"S\.disPrep && S\.disPrep\.sig !== prepSig\(\)\) S\.disPrep = \{ \.\.\.S\.disPrep, r: disPrepCompute",
                r"S\.failPrep && S\.failPrep\.sig !== prepSig\(\)\) S\.failPrep = \{ \.\.\.S\.failPrep, r: failPrepCompute",
                r"rc\.prep && rc\.prep\.sig !== prepSig\(\)\) rc\.prep = \{ \.\.\.rc\.prep, r: rcPrepCompute"):
        assert re.search(pat, S), pat


def test_slow_prepare_recomputes_and_announces_once():
    assert "S.slowPrep = { r: slowPrepCompute(), sig: prepSig(), changed: true }" in S
    assert "${slowChg ? `<p class=\"err\" role=\"alert\">The dataset or selection changed while this was open" in S
    assert "sig: S.slowPrep.sig, stale: true" not in S
