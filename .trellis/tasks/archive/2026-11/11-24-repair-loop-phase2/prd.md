# Repair loop phase 2

Source brief: `D:\projects\portfolio\docs\portfolio-rebuild\references\reignsagent-repair-loop-brief2-2026-11-24.md`.

## Requirements

- A. Scoring stays fixed (500 / 40 / seed 1) and the UI says so; `score_not_lower` strict; `gate_relaxed` advisory.
  Relevance context selection (40 cards / 24 KiB) only for `repair_diagnostics`; other modes go back to the first 12 cards.
- B. Real-model eval mode against local Magpie (`http://127.0.0.1:3425/v1`, model `auto/deepseek-v4.1-flash`, no key):
  real cases give only the broken deck + target; same checks; k = 3 per real-capable case; one retry on infra failure;
  at most 150 requests; results JSON + notes in the repo.
- C. Portfolio screenshots A, B, C, E, F (+ one real-model example) at deviceScaleFactor 2, width 1440, English light UI,
  element crops + full pages, README listing source and mock/real.

## Acceptance Criteria

- [ ] Generate/media modes send at most 12 deck cards; repair mode uses relevance selection; tests and docs updated.
- [ ] `npm run eval:repair -- --real` (or equivalent) runs real cases, records success, rounds, blocks, time, bytes, tokens.
- [ ] Real results committed under `scripts/repair-eval/results/` with a short README; numbers not invented.
- [ ] Screenshots saved to the portfolio evidence folder with README.
- [ ] `npm run verify`, `npm run test:hosted`, build:game pass.
