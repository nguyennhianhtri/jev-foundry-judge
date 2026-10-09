# Self-hosting an open-weight decision model

Two options: [Clef-flash](#clef-flash-cpu-9b) (9B, runs on a CPU VM) and [pplx-decider-v1.1-27b](pplx-decider/README.md) (27B, needs one 80 GB GPU; deploy script included). The pplx-decider run used a single Azure Container Apps serverless A100 80GB, and it is the most accurate open model we measured on both benchmarks below.

The judge and the router talk to Jev through one HTTP call: `POST /v1/systemone`. Open-weight decision models now expose the same API, so you can run the whole pattern inside your own Azure subscription. No third-party key is needed and no data leaves the tenant.

This folder has a small server ([`server.py`](server.py)) that serves [Cloudflare Clef-flash](https://huggingface.co/Cloudflare/clef-flash) (9B, Apache-2.0) behind a Jev-compatible endpoint. It also includes a [`cloud-init.yaml`](cloud-init.yaml) that builds the VM for you.

## Results on the same benchmarks

All numbers come from one run on an Azure `Standard_D16as_v7` (16 vCPU, 64 GB RAM, **no GPU**). Raw files and scoring scripts are in [`benchmark/router/open-models/`](../benchmark/router/open-models/) and [`benchmark/results/open-models/`](../benchmark/results/open-models/).

**Router (240 frozen public prompts, same labels and model cards as the Jev run):**

| Router | Accuracy | Saving vs always-strong | p50 latency | $ / 1k routes |
|---|---|---|---|---|
| Jev (hosted API) | 86% | 46% | 279 ms | $0.023 |
| Jev + fallback | 94% | 37% | 279 ms | $0.023 |
| **Clef-flash, self-hosted CPU VM** | **95%** | 29% | 2.3 s | $0.50 (VM time) |
| **pplx-decider-v1.1-27b, self-hosted A100** | **96%** | 34% | 0.74 s (over HTTPS) | $0.50 (GPU time only) |
| CLM-8B, self-hosted CPU VM | 46% | n/a | 1.1 s | $0.29 (VM time) |
| LLM router (gpt-5.4-mini) | 80% | 51% | 1.5 s | $0.475 |

Clef-flash made no "hard prompt sent to the small model" mistakes (0 of 160). Its few errors went the safe way: 13 easy prompts were sent to the strong model. The confidence fallback does not help it, because it is already conservative. CLM-8B is not usable for routing without fine-tuning.

**Judge (47 agent conversations, 164 metric scores, same questions and weights as Jev):**

| Judge | Agreement with human labels | MAE | Pearson r | p50 per conversation |
|---|---|---|---|---|
| Jev (hosted API) | 86% | 0.66 | 0.84 | 0.3 s |
| **pplx-decider-v1.1-27b, self-hosted A100** | **85%** | 0.58 | 0.85 | 3.0 s |
| **Clef-flash, self-hosted CPU VM** | **82%** | 0.88 | 0.71 | 16.7 s |
| Foundry built-in LLM judge (gpt-5.4-mini) | 72% | 1.24 | 0.49 | ~6.4 s |

Clef-flash is close to Jev on Intent Resolution (92%), Task Adherence (85%) and Groundedness (82%). It is weaker on Tool Call Accuracy (66%). The questions were written and weighted for Jev, not re-tuned for Clef.

**Which one to use**
- **Router, data must stay in the tenant:** Clef-flash on a VM. It is as accurate as Jev with fallback, and 2–3 s is fine for routing long-running or batch work. For interactive traffic, use a GPU VM (vendor figures are ~40 ms on GPU).
- **Judge:** Jev for speed and cost. Clef-flash on CPU is accurate enough for nightly or offline evaluation runs, where 17 s per conversation does not matter.
- **Cost:** on CPU, a self-hosted model costs more per call than the Jev API. Self-host for data residency and control, not to save money. The VM costs about US$0.73/hour, so deallocate it when idle.

## Deploy

Requirements: an Azure subscription with quota for a 16-vCPU general-purpose VM (no GPU needed), and the Azure CLI.

```bash
RG=rg-selfhost-decision; LOC=eastus2; VM=vm-decision
az group create -n $RG -l $LOC
az vm create -g $RG -n $VM -l $LOC \
  --image Canonical:ubuntu-24_04-lts:server:latest \
  --size Standard_D16as_v7 --os-disk-size-gb 128 \
  --public-ip-address "" --nsg-rule NONE \
  --custom-data selfhost/cloud-init.yaml \
  --generate-ssh-keys
# Daily auto-shutdown keeps the bill bounded (times are UTC)
az vm auto-shutdown -g $RG -n $VM --time 1400
```

Setup takes about 10 minutes: it installs PyTorch and downloads ~18 GB of weights. Then set a real key and restart the service:

```bash
KEY=$(openssl rand -hex 24)   # store it in Key Vault
az vm run-command invoke -g $RG -n $VM --command-id RunShellScript --scripts \
  "sed -i 's/SELFHOST_API_KEY=.*/SELFHOST_API_KEY=$KEY/' /etc/systemd/system/systemone.service && systemctl daemon-reload && systemctl restart systemone && sleep 30 && curl -s localhost:8700/health"
```

The VM has no public IP. Reach it from inside the VNet: put Container Apps or APIM in the same VNet (or a peered one) and call `http://<vm-private-ip>:8700/v1/systemone`.

**If 16 vCPU sizes are not available in your region**, any 8+ vCPU, 32+ GB VM works. It will be slower. Clef (27B) needs about 64 GB of RAM on CPU, or a GPU with 41 GB+ of VRAM.

## Point the judge, router and APIM at it

The client reads two environment variables, so nothing else changes:

```bash
export JEV_URL=http://<vm-private-ip>:8700/v1/systemone
export JEV_MODEL=clef-flash
export JEV_API_KEY=<the key you set>
```

- **Python / Foundry evaluators:** `JevAgentJudge(api_key=...)` and the per-metric evaluators pick these up.
- **Demo app (Container Apps):** set the same variables on the container app. Visitors still paste a key, which is now your self-hosted key.
- **APIM router:** store the self-hosted key in the `jev-key` Key Vault secret, and set `JEV_URL`/`JEV_MODEL` on the router app. The APIM policy needs no changes.

## Reproduce the benchmarks

Point `JEV_URL`, `JEV_MODEL` and `JEV_API_KEY` at your VM, then:

```bash
cd benchmark/router && python run_bench.py            # router, 240 prompts
python scripts/benchmark.py <app-url> <out-dir>         # judge, through a demo app configured with the same variables
python benchmark/router/open-models/score.py            # re-score the committed raw results
PYTHONPATH=src python benchmark/results/open-models/score.py
```
