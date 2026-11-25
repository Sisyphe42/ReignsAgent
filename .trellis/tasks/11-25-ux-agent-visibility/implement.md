# Implementation plan

1. Progress plumbing: reviewer onProgress/async, interface runDiagnostics(Async), pipeline stages,
   repair-loop stages, server NDJSON, review worker progress, browser backend, HttpCreatorBackend stream.
   Tests: reviewer equality + progress, pipeline stage order, repair-loop stage order/failure stage,
   server NDJSON integration.  Commit.
2. AI progress UI + review progress UI (disabled button, completed/total).  Commit with 1 or separately.
3. Context card selection report fields + UI component. Tests: context-selection omitted reasons.  Commit.
4. Repair history: record builder, contracts, Node + OPFS stores, routes, UI. Tests: contracts limits,
   workspace store, server integration (append, apply outcome, delete, no key), hosted browser.  Commit.
5. CSS / layout fixes (light skins, phantom, 834, nowrap, empty deck). Hosted browser test for empty deck,
   834 layout and button state.  Commit.
6. Docs: README/ROADMAP/spec contracts. Mock endpoint delay option + demo flag for reproduction.
7. Gates: `npm run verify`, `npm run test:hosted`, `npm run eval:repair`, `npm run build:game ...`.
8. Handoff in portfolio references.

Rollback points: each commit is independent; NDJSON is opt-in so reverting the UI keeps API compatible.
