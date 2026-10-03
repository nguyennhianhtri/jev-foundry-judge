"""t_13560ff0: explicit metric lists are validated exactly; unknown/mistyped names are refused (400) before any call."""
import pytest
from fastapi import HTTPException
import app.main as m

ALL = ["intent_resolution", "task_adherence", "tool_call_accuracy", "groundedness"]


def err(body):
    with pytest.raises(HTTPException) as e:
        m._metrics(body)
    assert e.value.status_code == 400
    return e.value.detail


def test_omitted_or_null_is_all_metrics_default():
    assert m._metrics({}) == ALL and m._metrics({"metrics": None}) == ALL


def test_valid_selection_canonical_order_and_dedup_unchanged():
    assert m._metrics({"metrics": ["groundedness", "tool_call_accuracy", "groundedness"]}) == ["tool_call_accuracy", "groundedness"]
    assert m._metrics({"metrics": list(reversed(ALL))}) == ALL


def test_empty_list_still_refused():
    assert "at least one metric" in err({"metrics": []})


@pytest.mark.parametrize("bad", [["groundedness", "groundednes"], ["bogus"], ["Groundedness"], [" groundedness"]])
def test_unknown_names_refused_naming_them_and_allowed_ids(bad):
    d = err({"metrics": bad})
    wrong = [x for x in bad if x not in ALL]
    for w in wrong:
        assert repr(w) in d                      # exact identifier echoed, no typo repair
    assert all(a in d for a in ALL) and "nothing was run" in d.lower()


@pytest.mark.parametrize("bad", ["groundedness", {"groundedness": True}, 3, True])
def test_non_list_container_refused(bad):
    assert "must be a list" in err({"metrics": bad})


@pytest.mark.parametrize("bad", [[1], ["groundedness", None], [["groundedness"]]])
def test_non_string_members_refused(bad):
    assert "strings" in err({"metrics": bad})


def test_both_endpoints_refuse_malformed_with_zero_downstream_calls(monkeypatch):
    from fastapi.testclient import TestClient
    calls = []
    boom = lambda *a, **k: calls.append(1) or (_ for _ in ()).throw(AssertionError("downstream called"))
    monkeypatch.setattr(m.JevClient, "ask", boom)
    monkeypatch.setattr(m.foundry_run, "run", boom)
    monkeypatch.setattr(m.baseline, "run_metric", boom)
    monkeypatch.setattr(m.foundry_run, "project_endpoint", lambda: "https://example.invalid/project")
    c = TestClient(m.app)
    row = [{"id": "a", "query": "q", "response": "r"}]
    for path in ("/api/judge", "/api/foundry-run"):
        for metrics in (["groundedness", "groundednes"], ["bogus"], "groundedness", [1], []):
            r = c.post(path, headers={"x-jev-key": "k"}, json={"rows": row, "metrics": metrics, "baseline": True})
            assert r.status_code == 400 and "metric" in r.json()["detail"].lower(), (path, metrics, r.text)
    assert calls == []


def test_long_unknown_list_error_is_capped_and_lookalikes_refused():
    d = err({"metrics": [f"x{i}" * 50 for i in range(30)]})
    assert "(+20 more)" in d and len(d) < 1200
    assert "groundedn\u0435ss" in err({"metrics": ["groundedn\u0435ss"]})   # Cyrillic e, exact match only
    assert "strings" in err({"metrics": [{"a": 1}]})


def test_non_object_body_is_400_not_500(monkeypatch):
    from fastapi.testclient import TestClient
    monkeypatch.setattr(m.foundry_run, "project_endpoint", lambda: "https://example.invalid/project")
    c = TestClient(m.app)
    for path in ("/api/judge", "/api/foundry-run"):
        for body in ([], "x", 3):
            r = c.post(path, headers={"x-jev-key": "k"}, json=body)
            assert r.status_code == 400 and "json object" in r.json()["detail"].lower(), (path, body, r.text)


def test_baseline_counter_untouched_on_refusal(monkeypatch):
    from fastapi.testclient import TestClient
    used = []
    monkeypatch.setattr(m, "_baseline_allow", lambda n: used.append(n) or True)
    monkeypatch.setattr(m.baseline, "configured", lambda: True)
    TestClient(m.app).post("/api/judge", headers={"x-jev-key": "k"},
                           json={"rows": [{"id": "a"}], "metrics": ["bogus"], "baseline": True})
    assert used == []
