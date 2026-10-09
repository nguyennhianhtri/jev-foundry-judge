# pplx-decider-v1.1-27b behind the System One API (POST /v1/systemone). Runs on an NVIDIA A100 80GB or larger.
# The serving code is Perplexity's reference implementation, pinned to a commit and fetched at build time.
# Weights (about 54 GB, Apache-2.0) are downloaded on first start into $HF_HOME, so mount a persistent volume there.
FROM python:3.12-slim

ARG HF_REVISION=5cd25e3f8ae59ba65d1ebea74d8a06fa4a5f60fd
ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/models/hf \
    AUTOJEV_HOST=0.0.0.0 \
    PORT=8000
# Python package index used for the build. Defaults to PyPI; pass --build-arg PIP_INDEX_URL=<your feed> to use another.
ARG PIP_INDEX_URL=https://pypi.org/simple
ENV UV_INDEX_URL=${PIP_INDEX_URL}

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gcc libc6-dev && rm -rf /var/lib/apt/lists/*
# Triton compiles a small CUDA helper on first use. The NVIDIA driver (libcuda) is mounted by the GPU runtime.
ENV NVIDIA_VISIBLE_DEVICES=all NVIDIA_DRIVER_CAPABILITIES=compute,utility LD_LIBRARY_PATH=/usr/local/nvidia/lib64:/usr/lib/x86_64-linux-gnu
ENV TRITON_LIBCUDA_PATH=/usr/lib/x86_64-linux-gnu
RUN pip install --no-cache-dir uv

COPY requirements.txt /tmp/requirements.txt
RUN uv pip install --system --no-cache -r /tmp/requirements.txt

RUN mkdir -p /app/autojev && cd /app/autojev && \
    for f in __init__ model types server; do \
      curl -fsSL "https://huggingface.co/perplexity-ai/pplx-decider-v1.1-27b/resolve/${HF_REVISION}/source/src/autojev/$f.py" -o $f.py; \
    done
ENV PYTHONPATH=/app

COPY entrypoint.py /app/entrypoint.py
EXPOSE 8000
CMD ["python", "/app/entrypoint.py"]
