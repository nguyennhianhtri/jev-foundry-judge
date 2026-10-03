import inspect
from jev_foundry_judge import foundry_run


def test_builtin_wrapper_signature_has_no_varkw():
    # azure-ai-evaluation introspects __call__; **kwargs would become a required "kw" input
    ps = inspect.signature(foundry_run._BuiltIn("groundedness").__call__).parameters
    assert all(p.kind != p.VAR_KEYWORD for p in ps.values())


def test_to_app_results_maps_evaluate_rows():
    src = [{"id": "a", "human_groundedness": 5}]
    out = [{"inputs.id": "a", "outputs.jev.groundedness": 4.0, "outputs.jev.groundedness_result": "pass",
            "outputs.jev.jev_properties": {"latency_ms": 300, "input_tokens": 900},
            "outputs.groundedness.groundedness": 5.0, "outputs.groundedness.latency_ms": 2000}]
    r = foundry_run.to_app_results(out, src, ["groundedness"])[0]
    assert r["jev"]["groundedness"] == 4.0 and r["llm"]["groundedness"]["score"] == 5.0
    assert r["human"]["groundedness"] == 5 and r["jev_meta"]["latency_ms"] == 300


def test_nan_is_cleaned():
    out = [{"inputs.id": "a", "outputs.jev.groundedness": float("nan"), "outputs.jev.jev_properties": {"x": float("nan")}}]
    r = foundry_run.to_app_results(out, [{"id": "a"}], ["groundedness"])[0]
    import json; json.dumps(r, allow_nan=False)
