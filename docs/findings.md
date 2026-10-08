# Findings: decision models for agent evaluation and model routing

One page that collects everything measured in this repo. Each figure links to its raw data. All runs are single runs on small public or synthetic sets, so read them as reproducible signals, not leaderboards.

## 1. Agent evaluation (Foundry judge)

47 agent conversations, 164 metric scores, human labels on every row. Same four metrics as the Foundry built-ins.

| Judge | Agreement with humans (pass/fail) | MAE (1–5) | Pearson r | p50 per conversation | $ / 1k conversations |
|---|---|---|---|---|---|
| Jev (TypeSafe API) | **86%** | **0.66** | **0.84** | **0.3 s** | **$0.06** |
| Clef-flash (open weights, self-hosted CPU VM) | 82% | 0.88 | 0.71 | 16.7 s | ~$3.20 (VM time) |
| Foundry built-in LLM judge (gpt-5.4-mini) | 72% | 1.24 | 0.49 | ~6.4 s | $7.19 |

- Jev costs about 118× less than the LLM judge on the same workload (38 conversations where both judges scored the same metrics).
- Clef-flash comes close to Jev on Intent Resolution (92%), Task Adherence (85%) and Groundedness (82%). It is weaker on Tool Call Accuracy (66%). The questions were tuned on Jev and not re-tuned for Clef.
- Data: [`benchmark/results/`](../benchmark/results/), [`benchmark/results/open-models/`](../benchmark/results/open-models/).

## 2. Model routing (small / strong / code)

240 frozen public prompts (MMLU, GSM8K, HumanEval, MBPP, Dolly; 80 per class). Labels were fixed before any router ran.

| Router | Accuracy | Hard prompts sent to small | Saving vs always-strong | p50 latency | $ / 1k routes |
|---|---|---|---|---|---|
| Jev | 86% | 32 | 46% | 279 ms | $0.023 |
| Jev + fallback (confidence < 0.6 → strong) | 94% | 11 | 37% | 279 ms | $0.023 |
| **Clef-flash, self-hosted CPU VM** | **95%** | **0** | 29% | 2.3 s | ~$0.50 (VM time) |
| CLM-8B, self-hosted CPU VM | 46% | – | – | 1.1 s | ~$0.29 (VM time) |
| LLM router (gpt-5.4-mini) | 80% | 46 | 51% | 1.5 s | $0.475 |
| Embedding similarity | 53% | 9 | 19% | 446 ms | $0.0014 |

- Clef-flash errs only toward safety: it sent 13 easy prompts to the strong model and never sent a hard prompt to the small one. That costs some savings, and it is why the confidence fallback does not help it.
- CLM-8B is not usable for routing without fine-tuning.
- Behind APIM, the Jev router scored 58/60 on a stratified subset, with p50 routing overhead of 125 ms.
- Data: [`benchmark/router/`](../benchmark/router/), [`benchmark/router/open-models/`](../benchmark/router/open-models/), [`benchmark/apim/`](../benchmark/apim/).

## 3. What we concluded

1. **A decision model beats an LLM at both jobs.** It answers typed questions with calibrated probabilities in one call, instead of writing an essay and then a number.
2. **Put a rule table first.** Health, budget, quota/PTU, rate limits and region rule out candidates for free. Call the decision model only when more than one model is still feasible. Under simulated pressure, this skipped 25% of decision calls with no loss of accuracy.
3. **The decision model is swappable.** Jev, Clef and Clef-flash share the same `POST /v1/systemone` API, so you change two settings (`JEV_URL`, `JEV_MODEL`) and nothing else.
4. **Choose by constraint, not by benchmark alone:**
   - Lowest latency and cost → Jev API.
   - Data must stay in the tenant → self-hosted Clef-flash. On CPU it fits batch or offline use; for interactive routing, add a GPU.
   - Images or video in the state → Clef (Jev is text-only).
5. **Self-hosting on CPU is not cheaper.** It is a residency and control choice. Deallocate the VM when it is idle.

## 4. Where the pieces live

- Python judge and router: [`src/jev_foundry_judge/`](../src/jev_foundry_judge/)
- APIM AI gateway (`auto` deployment, pools, circuit breakers): [`infra/apim/`](../infra/apim/), [`docs/apim-router.md`](apim-router.md)
- Self-hosted open-weight endpoint plus VM deployment: [`selfhost/`](../selfhost/)
- Java implementation for a Model Proxy (rule table + System One chooser, `POST /amr/route`, offline benchmark replaying the Jev and Clef-flash answers above): the `feature/jev-clef-router` branch of the Advanced Model Router project.

## 5. Open items

- **GPU numbers:** rerun Clef / Clef-flash on a GPU once quota is available, to get interactive-grade latency.
- **Re-tune for Clef:** adjust the judge questions for Clef, especially Tool Call Accuracy.
- **Independent labels:** the human labels were written by the dataset author, so a second annotator would strengthen the evaluation results.
