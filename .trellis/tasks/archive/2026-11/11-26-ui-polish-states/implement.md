# Implement

1. `ai-status-copy.js` + `test/integration/ai-status-copy.test.js` (failure classes, sentence joining, stop labels).
2. Cancel state: progressStatus `cancelled`, neutral notice + Build again, progress/loop classes, CSS.
3. Failure advice by type: notice actions (Retry / Edit prompt / Settings), failure code passed through `onProgress`.
4. Repair stop labels via `repairStopLabel` in the verification summary and history detail.
5. Narrow rail tab strip CSS + scroll active tab into view.
6. Double punctuation: repair instruction and `formatAiEndpointError`.
7. Browser spec `test/browser/ui-polish-states.spec.js`: cancel (neutral, not red), 503 advice, round-2 subtitle (scripted CORS mock with the fog-harbor eval case), 390 px nav in github-light and phantom.
8. `demo.mjs`: `DEMO_AI_CASE` docs list the cancel/503/round-2 recipes.

Validation: `npm run verify`, `npm run test:hosted`, `npm run eval:repair`.
Commits: one per concern (copy module + cancel/advice, stop labels, nav, punctuation, tests/docs).
