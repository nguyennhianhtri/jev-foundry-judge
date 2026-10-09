"""Serve pplx-decider-v1.1-27b on the System One API.

Opens the port immediately and answers /health with "loading" while the weights download (first start) and load onto
the GPU, then hands every request to Perplexity's reference AutoJev server. This keeps platform startup probes
(Azure Container Apps gives up after about 4 minutes) from killing the container during a 54 GB first download.

Environment: AUTOJEV_API_KEY (optional bearer key), PPLX_REVISION (checkpoint commit), HF_HOME (cache location),
PORT. Probe /health for readiness: it returns 503 with status "loading" until the model is on the GPU.
"""
import json
import os
import threading
import traceback
from datetime import UTC, datetime
from pathlib import Path

REPO = os.environ.get("PPLX_REPO", "perplexity-ai/pplx-decider-v1.1-27b")
REV = os.environ.get("PPLX_REVISION", "5cd25e3f8ae59ba65d1ebea74d8a06fa4a5f60fd")

state = {"app": None, "status": "loading", "error": None}


def selfcheck() -> None:
    """Print what the GPU runtime exposes, so a failed first request is explainable from the logs."""
    import glob
    import subprocess

    print("libcuda:", glob.glob("/usr/lib/x86_64-linux-gnu/libcuda*") + glob.glob("/usr/local/nvidia/lib64/libcuda*"),
          flush=True)
    try:
        import torch

        print("cuda available:", torch.cuda.is_available(),
              torch.cuda.get_device_name(0) if torch.cuda.is_available() else "", flush=True)
    except Exception as error:  # noqa: BLE001
        print("torch check failed:", error, flush=True)
    src = "/usr/local/lib/python3.12/site-packages/triton/backends/nvidia/driver.c"
    result = subprocess.run(["gcc", src, "-O3", "-shared", "-fPIC", "-o", "/tmp/probe.so", "-l:libcuda.so.1",
                             "-L/usr/lib/x86_64-linux-gnu", "-L/usr/local/nvidia/lib64",
                             "-I/usr/local/lib/python3.12/site-packages/triton/backends/nvidia/include",
                             "-I/usr/local/include/python3.12"], capture_output=True, text=True)
    print("triton helper compile:", result.returncode, result.stderr[-600:], flush=True)


def load() -> None:
    try:
        selfcheck()
        from huggingface_hub import snapshot_download

        state["status"] = "downloading"
        checkpoint = snapshot_download(REPO, revision=REV, allow_patterns=["*.safetensors", "*.json", "*.jinja"])
        state["status"] = "loading-gpu"
        from autojev import server
        from autojev.model import DecisionModel

        server.service.checkpoint = checkpoint
        server.service.model = DecisionModel(checkpoint=checkpoint)
        server.service.name = f"autojev-{server.service.model.base_model.rsplit('/', 1)[-1].lower()}"
        modified = (Path(checkpoint) / "decision_config.json").stat().st_mtime
        server.service.release_date = datetime.fromtimestamp(modified, UTC).date().isoformat()
        state["app"] = server.app
        state["status"] = "ready"
    except Exception as error:  # noqa: BLE001 - reported on /health, the platform restarts the replica
        state["status"] = "failed"
        state["error"] = f"{type(error).__name__}: {error}"
        traceback.print_exc()


async def _json(send, status: int, body: dict) -> None:
    payload = json.dumps(body).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]})
    await send({"type": "http.response.body", "body": payload})


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                threading.Thread(target=load, daemon=True).start()
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    if state["app"] is not None:
        return await state["app"](scope, receive, send)
    if scope["type"] == "http":
        if scope["path"] == "/health":
            return await _json(send, 503, {"status": state["status"], "error": state["error"]})
        return await _json(send, 503, {"detail": f"The model is {state['status']}."})


def main() -> None:
    import uvicorn

    uvicorn.run(app, host=os.getenv("AUTOJEV_HOST", "0.0.0.0"), port=int(os.getenv("PORT", "8000")))


if __name__ == "__main__":
    main()
