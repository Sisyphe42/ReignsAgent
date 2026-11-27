# Agent observability and author-declined memory

## Goal

Close the observability and memory gaps named in the 2026-11-26 agent design research
("not built but worth building" items 1, 2, 4, 5): every AI request shows what it cost, the
activity log shows which repair check blocks most often, and a repair loop remembers the
changes the author declined or undid on the same issue.

## Requirements

1. **Usage per request.** Every logged AI request (repair loop rounds, drafts, selection
   actions, images) records tokens and bytes sent/received. When the endpoint returns a
   `usage` block, its token counts are used and marked as reported; otherwise tokens are
   estimated from bytes (4 bytes per token) and marked as estimated. Usage is visible in the
   activity list row, in the replay (per request and per round), and in the JSON export.
2. **Block statistics.** Near the activity log: "over the last N repair loops, which check
   blocked most often", counted per check id, most frequent first. Each check is clickable and
   narrows the list to the runs it blocked, from which a run can be opened.
3. **Author-declined memory.** A repair proposal the author did not tick at Apply time, or
   applied and then undid, is remembered as a short summary on its record. The next repair
   run on the same issue (code + target cards) sends these summaries to the model from round 1
   as content, never instructions, with a count and byte cap. The Context section says
   "Includes N changes the author declined", next to and distinct from the existing
   "blocked attempts from an earlier run" line. The author can see and clear them (activity
   records).
4. **Draft context selection (if time allows).** Evaluate replacing "first 12 cards" in
   Draft cards mode with relevance selection; if changed, keep the 12-card budget and tests.

## Constraints

- AI is mocked in every test and demo; no real requests, no keys read or written.
- Core / player builds untouched; no provider SDKs; logs stay key-free and URL-free.
- Same behaviour on Creator Server and Hosted (browser backend + repair worker).

## Acceptance Criteria

- [x] Unit: usage extraction for OpenAI chat/responses, Anthropic, Gemini, none; record fields; estimate flag.
- [x] Unit: declined/undone marking, memory collection (same issue only, caps), loop sends it every round with the content role.
- [x] Unit: draft context uses relevance with the 12-card limit.
- [x] Integration: server plan -> apply (one unticked) -> undo route -> next plan carries `authorDeclined`; export contains usage.
- [x] Browser (Hosted): usage visible in list and replay; block stats click-through; declined memory line in Context after apply + undo.
- [x] `npm run verify`, `npm run test:hosted`, `npm run eval:repair` pass.
