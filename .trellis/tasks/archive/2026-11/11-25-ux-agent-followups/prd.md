# UX agent visibility follow-ups

User request (2026-11-25): "PR. 遗留问题全修. '不能讲的说法'轻量化实现" — open the PR, fix every
leftover from the phase-4 handoff, and make each "cannot claim" item true in a lightweight way.

## Leftovers to fix
- L1 Phantom red tag text at 4.49:1 -> AA.
- L2 "Valid / Ready" shows green with zero cards -> neutral "Empty" state.
- L3 Hosted repair loop runs on the main thread -> Web Worker.
- L4 History can only be viewed one record at a time -> side-by-side compare of two records.
- L5 Apply trusts the client-supplied plan -> server-issued plan token (HMAC over the plan content);
  apply rejects modified or foreign plans.
- L6 Structural checks ignore narrative quality -> lightweight advisory narrative checks
  (empty/placeholder text, duplicate text, placeholder or identical choice labels, language mismatch).

## "Cannot claim" items, made true lightly
- C1 Agent decides when to stop and which cards to read: the model may return `contextRequests`
  (card ids to see next round, bounded) and `stop { reason }` (ends the loop as `model_stopped`).
- C2 Remaining-time estimate: Review ETA from measured throughput; model wait shows the median of
  recent request durations from repair history.
- C3 History keeps the full (redacted, size-bounded) model conversation per round, viewable in replay.
- C4 Every skin and every Creator panel passes an automated WCAG AA text-contrast scan (browser test).
- C5 Hosted loop runs in a background worker (same as L3).
- C6 A live-model capture: a bounded run (<= 6 requests) against the keyless loopback endpoint used in
  earlier phases, recorded and replayable; skipped and reported if the endpoint is not reachable.

## Acceptance
- npm run verify, npm run test:hosted, npm run eval:repair pass; new tests for each item.
- Branch pushed and a PR opened against master (user-authorized).
- Handoff updated with the new claims and their limits.
