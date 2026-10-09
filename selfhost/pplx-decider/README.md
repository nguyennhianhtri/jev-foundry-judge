# pplx-decider-v1.1-27b on your own Azure subscription

[pplx-decider-v1.1-27b](https://huggingface.co/perplexity-ai/pplx-decider-v1.1-27b) is Perplexity's open-weight decision model (27B, Apache-2.0, text and image). It serves the same `POST /v1/systemone` API as Jev, so the judge and the router use it by changing `JEV_URL` and `JEV_MODEL`. Nothing else changes.

## Hardware

The weights are about 54 GB in BF16, so it needs one 80 GB GPU. Azure Container Apps serverless GPU runs it on an **NVIDIA A100 80GB** (`Consumption-GPU-NC24-A100`), with no VM GPU quota needed. It was tested in Sweden Central. Other regions that list that profile should work; check with `az containerapp env workload-profile list-supported -l <region>`.

## Deploy

```bash
RG=rg-pplx LOCATION=swedencentral ./deploy.sh
```

The script builds the image in a new registry, creates a GPU environment and a container app, and prints the endpoint and a generated API key. `/health` returns `loading` or `downloading` until the first start finishes downloading and loading the weights. Then it returns `ready`.

```bash
export JEV_URL=https://<fqdn>/v1/systemone JEV_MODEL=jev-latest JEV_API_KEY=<key>
```

## Operating notes

- **Cost:** the GPU is billed per second while a replica runs. With `MIN_REPLICAS=0` it scales to zero when idle, but a cold start re-downloads the weights; set `MIN_REPLICAS=1` for interactive use.
- **Concurrency:** the reference server handles one request at a time and answers HTTP 529 when busy. The router treats that as a failure and falls back to the strong model, so run one replica per about 10 requests per second.
- **Batching:** prefix caching is off for this model, so a request costs about *questions × prompt tokens*. Batching prompts into one request saves only the fixed instructions.
- **Image:** the container uses Perplexity's reference serving code, pinned to a commit, and pip packages pinned to the versions in `requirements.txt`.

## Results (same benchmarks, same questions, no re-tuning)

Run on one Container Apps serverless A100 80GB in Sweden Central, called over HTTPS from a laptop. Raw files and scoring are in `benchmark/router/open-models/` and `benchmark/results/open-models/`.

**Router, 240 frozen prompts (small / strong / code):**

| Router | Accuracy | Hard prompts sent to small | p50 latency | Compute per 1k routes |
|---|---:|---:|---:|---:|
| Jev (hosted API) | 86% | 30 | 0.28 s | $0.023 |
| Jev + fallback (< 0.6 to strong) | 94% | 11 | 0.28 s | $0.023 |
| Clef-flash, CPU VM | 95% | 0 | 2.3 s | $0.50 |
| **pplx-decider-v1.1-27b** | **96%** | 5 | 0.74 s | $0.50 (GPU meter only) |
| pplx-decider + fallback | 95% | 1 | 0.74 s | $0.50 |

**Judge, 47 conversations (164 metric scores):**

| Judge | Agreement with human labels | MAE | Pearson r | p50 per conversation |
|---|---:|---:|---:|---:|
| Jev (hosted API) | 86% | 0.66 | 0.84 | 0.3 s |
| **pplx-decider-v1.1-27b** | **85%** | 0.58 | 0.85 | 3.0 s |
| Clef-flash, CPU VM | 82% | 0.88 | 0.71 | 16.7 s |
| Foundry built-in LLM judge | 72% | 1.24 | 0.49 | ~6.4 s |

**Output type (text, image or audio), in the same call as the model choice, on the AMR prompt-classifier test set (180 prompts, a third Thai):** 97.2% with one prompt per call, against Jev 100% and keyword rules 81%. All the misses were Thai audio requests.

What this means:

- pplx-decider routes as well as the best earlier open model and judges within a point of Jev, and it runs in your subscription so prompts never leave the tenant.
- It is not cheaper than the Jev API. Compute per route is about 20x Jev's price per route. Choose it for data residency, not savings. A busy replica amortises the GPU: one replica handled this test one request at a time at about 1.3 routes per second.
- Batching helps up to about 10 prompts per call and then stops: 763 ms per prompt at 1, 208 ms at 10, 275 ms at 30 (the model rereads all the prompts for every question, so cost grows with batch size squared). Accuracy stayed 100% on the output-type set at 10 and 30 per call. Use 10 or fewer.
- One run each, n=240 and n=47. The error bars are several points wide, so treat the 96% vs 94-95% differences as a tie.
