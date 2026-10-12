# Microsoft-Decision-1 on Microsoft Foundry

[Microsoft-Decision-1](https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision) is Microsoft's decision model (Qwen3.5-9B base, public preview since 9 October 2026). It is a managed deployment in your own Foundry resource: no GPU to host, Microsoft Entra ID authentication, and `DataZoneStandard` in selected regions to keep inference inside a data zone. It answers the same System One request as Jev, so the judge and the router use it by changing `JEV_URL`, `JEV_MODEL` and the key.

## Check your region first

Availability is per region and per deployment type. Southeast Asia and East Asia do not list it yet, so a Foundry resource there cannot deploy it. Check before you plan:

```bash
az cognitiveservices model list -l <region> --query "[?model.name=='Microsoft-Decision-1'].model.skus[].name" -o tsv
```

At the time of writing it was listed in East US, East US 2, West US 3, North Central US, South Central US, Sweden Central, West Europe and France Central (GlobalStandard and DataZoneStandard), and in Australia East, Japan East and UK South (GlobalStandard only).

## Deploy

```bash
az cognitiveservices account deployment create -n <foundry-account> -g <rg> --deployment-name msft-decision-1 \
  --model-name Microsoft-Decision-1 --model-format Microsoft --model-version 1 \
  --sku-name GlobalStandard --sku-capacity 60     # 60 is the default per-region quota
```

The endpoint is `<foundry-account-endpoint>/providers/microsoft/v1/systemone`. The `model` field in each request is your deployment name.

```bash
export JEV_URL=https://<account>.cognitiveservices.azure.com/providers/microsoft/v1/systemone
export JEV_MODEL=msft-decision-1
export JEV_API_KEY=entra        # Entra ID: az login locally, managed identity in Azure. Needs azure-identity.
```

A Foundry API key also works: set `JEV_API_KEY` to the key and the client sends it in the `api-key` header.

## Rate limits

The preview quota is about 60 requests per minute per deployment type per region. A second deployment on the other type has its own 60, so `JEV_MODEL=msft-decision-1,msft-decision-1-dz` rotates requests across both. The client retries 429 responses after the `retry-after-ms` the service returns. Ask for more quota through the usual Foundry quota request if you need it.

## Results (same benchmarks, same questions, no re-tuning)

Called over HTTPS from a laptop to a Foundry resource in East US 2. Raw files: `benchmark/router/open-models/msft_decision_1_raw.csv` and `benchmark/results/open-models/msft_decision_1_judge.json`.

| | Jev (hosted) | Microsoft-Decision-1 (Foundry) | pplx-decider (self-hosted A100) |
|---|---:|---:|---:|
| Routing, 240 prompts, argmax | 86% | 87% | 96% |
| Routing, with fallback (< 0.6 to strong) | 94% | **96%** | 95% |
| Hard prompts sent to small, argmax / with fallback | 30 / 11 | 29 / 8 | 5 / 1 |
| Judge, 47 conversations (agreement with human labels) | 86% | 82% | 85% |
| Output type text / image / audio (180 prompts, a third Thai) | 100% | 91% | 97% |
| Time per call | 0.28 s | 1.1 to 1.2 s | 0.74 s |
| Cost per 1k routes (input tokens only) | $0.011 | $0.023 | $0.50 (GPU time) |

What this means:

- **Routing: use it with the confidence fallback.** Raw, it sent 29 of 160 hard prompts to the small model, the same weakness Jev has. With the fallback (low confidence goes to the strong model) it scored 96%, the best of the hosted models. It is confident on most prompts (median 0.985), so the fallback only triggers on 14% of them.
- **Judge: a little behind Jev** (82% against 86%) and well ahead of the built-in LLM judge (72%).
- **Output type: weaker on Thai** (45 of 60) than Jev (60 of 60) and pplx-decider (55 of 60). English was 119 of 120.
- **Latency is about four times Jev's**, mostly the Foundry gateway round trip. That matters for the router, which waits on the answer before every request.
- **Price:** published at $0.042 per million input tokens, about twice Jev's $0.02. Per route that is about two cents per thousand. Output is free.
- **Where it fits:** the managed choice when you are already on Azure and want Entra ID, no key to store, and in-tenant data handling (`DataZoneStandard` in selected regions). It is not the most accurate model we tested, and it is not available in Southeast Asia yet.
- One run each, n=240 and n=47. Differences of a few points are within noise.
