# Implement plan

1. Pipeline context selection + repair-loop prompt rule + unit tests. Commit.
2. Interface `repair-loop.js` (evaluate, feedback, loop, metered fetch) + apply guard + unit tests. Commit.
3. Server + Hosted backend routing + integration test with mock endpoint. Commit.
4. Creator UI verification view + CSS. Smoke via Playwright. Commit.
5. Eval cases + `npm run eval:repair` + integration test. Commit.
6. Docs: README / ROADMAP / spec `ai-edit-contracts.md`. Commit.
7. Optional request log (if 1-6 stable).

Validation each step: `npm run test:unit`, then `npm run verify`, `npm run test:hosted`,
`npm run build:game -- fixtures/content/oss-court.cards.json <tmp>` before the final commit.
Rollback points: each commit.
