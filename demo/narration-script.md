# Narration script: Jev Foundry Judge demo (for T's own voice)

Matched to `jev-foundry-judge-demo-silent.mp4`: 1920×1080, 77.2 s, silent, captured from live v1.40.0-202609280427 (rev 61) on 2026-09-28 05:04 SGT. The only edit is the run wait (about 14.5 s of "Running…"), which plays at 4× from 0:45.
Each `[mm:ss.s]` line is one clip. `make_voiceover.py` places each clip at its time and warns if a line runs into the next cue. Aim for about 150 words a minute.
To record in your own voice, save one file per line as `l00.wav`, `l01.wav` and so on, then run `python make_voiceover.py --recordings <dir>`. No synthetic voice is used.

- [00:00.3] Jev as the judge for Foundry agent evals.
- [00:04.2] Bring your own Jev key. It stays in this tab and is never stored.
- [00:10.8] Start from a synthetic support scenario with tool calls.
- [00:15.7] Or bring your own traces. The guide lists the fields.
- [00:20.6] Upload the starter template. Preview first.
- [00:24.5] The inspector shows the exact case that Apply will add.
- [00:30.9] Nine cases, each with a one-to-five label per metric.
- [00:35.4] Run Jev next to Foundry's built-in LLM judge on all four metrics.
- [00:41.3] One Jev call per conversation covers every metric. Both judges run in one evaluate call.
- [00:49.2] The dashboard. Every number is from this run.
- [00:53.0] Cost and time, compared on the same workload only.
- [00:57.7] Agreement with my synthetic labels. A first signal.
- [01:03.6] Export the results, the evaluated dataset and a benchmark brief.
- [01:10.8] Then run them in your own Foundry project.
- [01:14.3] Try it with your own key.

Notes for recording:
- Numbers on screen in this take (live run, 9 synthetic rows, 2026-09-28 05:04 SGT):
  - Jev: p50 277 ms per call (one call covers all metrics of a row), $0.018 per 1k metric evaluations.
  - LLM judge: 1.66 s per metric call, $2.042 per 1k.
  - Same workload (7 of 9 rows, 28 metric evaluations each): $0.00049 vs $0.058, 120× for the LLM judge.
  - Pass/fail agreement with the author-written labels: Jev 97% (n 34), LLM judge 81% (n 32).
- Say "on these synthetic rows" before any agreement number. Do not quote 120× as a general claim.
- Latency is not like-for-like: Jev makes one call per row, the LLM judge one call per metric, and its per-row time is a sum of calls that actually run in parallel. Do not compare the two p50s aloud.
- Say "Jev" as one syllable, rhyming with "rev".
