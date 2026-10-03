"""Register the four Jev evaluators as custom (code-based) evaluators in a Foundry project.

Uses the Foundry project Evaluators API (`POST {project}/evaluators/{name}/versions`,
api-version v1, `Foundry-Features: Evaluations=V1Preview`), the same call as
azure-ai-projects `project_client.beta.evaluators.create_version(...)`.
The evaluator source is stdlib-only, so it is sent inline as `code_text`.
No key is embedded: the Jev API key is an init parameter supplied at run time.

    python scripts/register_evaluators.py https://<acct>.services.ai.azure.com/api/projects/<project>
"""
import json, re, sys, urllib.request
from pathlib import Path
from azure.identity import DefaultAzureCredential

SRC = Path(__file__).resolve().parents[1] / "src" / "jev_foundry_judge"
EVALS = {"intent_resolution": "JevIntentResolutionEvaluator", "task_adherence": "JevTaskAdherenceEvaluator",
         "tool_call_accuracy": "JevToolCallAccuracyEvaluator", "groundedness": "JevGroundednessEvaluator"}


def code_text(cls: str) -> str:
    client = (SRC / "jev_client.py").read_text()
    ev = (SRC / "evaluators.py").read_text().replace("from .jev_client import JevClient, JevResult\n", "")
    ev = re.sub(r"^from __future__ import annotations\n", "", ev, flags=re.M)
    return client + "\n\n" + ev + f"\n\nclass JevEvaluator({cls}):\n    \"\"\"Foundry entry point.\"\"\"\n"


def main(ep: str):
    tok = DefaultAzureCredential().get_token("https://ai.azure.com/.default").token
    for m, cls in EVALS.items():
        name = f"jev_{m}"
        body = {"display_name": f"Jev {m.replace('_', ' ').title()}", "evaluator_type": "custom",
                "categories": ["agents" if m != "groundedness" else "quality"],
                "description": f"TypeSafe Jev as judge for {m}: typed atomic checks in one call, combined in code (1-5).",
                "metadata": {"source": "github.com/nguyennhianhtri/jev-foundry-judge"},
                "definition": {"type": "code", "code_text": code_text(cls), "entry_point": "JevEvaluator",
                               "init_parameters": {"type": "object", "properties": {"api_key": {"type": "string"},
                                                   "threshold": {"type": "number"}}, "required": ["api_key"]},
                               "data_schema": {"type": "object", "properties": {k: {} for k in
                                               ("query", "response", "tool_definitions", "tool_calls", "context")},
                                               "required": ["query", "response"]},
                               "metrics": {m: {"type": "ordinal", "desirable_direction": "increase", "min_value": 1,
                                               "max_value": 5, "threshold": 3, "is_primary": True}}}}
        req = urllib.request.Request(f"{ep}/evaluators/{name}/versions?api-version=v1", method="POST",
                                     data=json.dumps(body).encode(), headers={
                                         "Authorization": f"Bearer {tok}", "Content-Type": "application/json",
                                         "Foundry-Features": "Evaluations=V1Preview"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.loads(r.read()); print("registered", name, "version", d.get("version"))
        except urllib.error.HTTPError as e:
            print("FAILED", name, e.code, e.read().decode()[:600]); sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1].rstrip("/"))
