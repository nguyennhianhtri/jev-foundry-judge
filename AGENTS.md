# AGENTS.md - jev-foundry-judge

## Definition of done (agent rules)
- Done means verified against the RUNNING app, not just tests. Attach evidence (screenshot, trace, response, reload-persistence check) to the task or PR.
- `docs/FEATURE-MAP.md` lists how to reach and exercise each feature and what success looks like. Keep it current; run its steps after any user-visible change.
- `node scripts/guard.mjs` must pass. When a mistake repeats, add a rule there in the same change; prose warnings do not count.
- Deploying means the exact source is committed, pushed and tagged with the live version.
