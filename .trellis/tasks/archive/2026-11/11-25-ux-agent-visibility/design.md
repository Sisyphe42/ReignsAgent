# Design

## Progress channel (R1 review progress, R2)

- Reviewer: `runMonteCarloReview` gains an optional `onProgress({ completed, total })` (throttled, sync) and a new
  `runMonteCarloReviewAsync` that yields to the event loop between chunks. Every cycle already uses
  `seed + cycle`, so chunking cannot change results (tested for equality).
- Interface: `runDiagnostics({ onProgress })` and `runDiagnosticsAsync`. Progress phases: `simulate` then `summarize`.
- Pipeline: `createAiEditSuggestions*` accept `onProgress({ stage })` with stages
  `context -> request -> response -> parse -> validate`. Local rule-based drafts emit `context -> draft -> validate`.
- Repair loop: `buildVerifiedRepairPlan({ onProgress })` emits `{ stage: "baseline" }`, then per round
  `{ round, maxRounds, stage: "request" | "response" | "parse" | "validate" | "trial" | "scoring" | "checks", proposalIndex, proposalCount }`.
  Proposal evaluation yields between stages so streamed events leave the server.
- Transport: opt-in NDJSON. A client sending `accept: application/x-ndjson` to `/api/diagnostics/run` or
  `/api/ai/edit/plan` gets `{"type":"progress",...}` lines and a final `{"type":"result","result":...}` or
  `{"type":"error","error":{message,code,stage}}`. Without the header the routes answer plain JSON as before
  (backward compatible for scripts/tests). Hosted: the review worker posts progress messages; the browser
  backend passes `onProgress` straight into the loop.
- Client: `backend.request(path, { onProgress })`. The UI maps stages onto the six steps; for endpoint
  drafts the third step is labelled "Response" (the step is waiting for/reading the model answer), for local
  drafts it stays "Local draft". A failed request marks the active step red (e.g. 503 -> Request).

## Context card selection (R3)

- `selectAiContextCards` report adds `tierOf` for omitted cards via `omittedReasons` (`count_limit` /
  `byte_budget`, counts) and `omittedTiers`; first_n reports `omittedReasons.count_limit`. Additive fields only.
- `ContextCardSelection` component under AI Assist "Context": summary line (included / omitted, tier counts,
  bytes used of budget) + `<details>` list of included cards with tier chip and reason, omitted ids with cause.
  Also shown inside the repair history replay (per record, first round context summary).

## Repair history (R4)

- Record builder in Interface (`createRepairHistoryRecord`): whitelisted fields only (no config, credentials,
  endpoint URL query, request/response bodies). Each round keeps status, scores, passed count, blocked-by
  counts, per-proposal `{ id, title, summary (<=240), passed, failedDetails (<=200 each), scoreAfter }`.
  Failed loops (endpoint error in round 1, invalid responses) are recorded with `status: "failed"` and error.
- Storage contract in `packages/workspace/src/contracts.js` (host-neutral): `normalizeRepairHistoryRecord`,
  `appendRepairHistory(list, record)` keeps the newest 40 records, record <= 48 KiB (oversized records drop
  per-proposal detail and get `truncated: true`). Stored as `repair-history.json` in the project directory by
  both the Node workspace store and the OPFS store. Deleting a project deletes it with the project.
- Server and browser backend append on every verified-repair build (success or failure), and on
  `/api/ai/edit/apply` with `historyId` mark `{ outcome: "applied", appliedProposalIds, appliedAt }`.
  The server scrubs the stored API key string from the record before writing (defence in depth).
- Routes: `GET /api/ai/repair-history`, `GET/DELETE /api/ai/repair-history/:id`, `DELETE /api/ai/repair-history`.
- UI: "Repair history" subsection in AI Assist: list (time, target, status, rounds, outcome), expand to show
  each round's proposals with scores and blocking checks, delete one, clear all.

## Interface fixes (R1)

- Light skins: introduce `--depth-mix` token (`#000` default dark behaviour; light skins set `#fff`) and replace
  `color-mix(..., #000)` surface mixes with it. Shadows keep black.
- Phantom: labels use `--ink`-on-surface tokens with >= 4.5:1; remove the diagonal stripe overlay behind text
  in metric cards and lower `body::before` stacking below panels.
- 834: a breakpoint between 768 and ~1100 px: top bar wraps into at most two rows; review grids switch to one
  column and list rows stack code above text.
- Metric values: `overflow-wrap: normal; word-break: keep-all` with `white-space: nowrap` for short values.
- Empty deck: new `EmptyDeck` state in Content when `cards.length === 0` with "Start with AI Assist" (primary)
  and "Add a blank card"/"Import JSON" (secondary); filters-with-no-result keep the existing text.

## Compatibility / rollback
- All API changes are additive (opt-in NDJSON, new routes, new report fields). Each requirement is its own commit.
