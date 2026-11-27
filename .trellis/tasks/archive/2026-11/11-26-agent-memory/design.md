# Design

## 1. Usage

- `extractEndpointUsage(text)` (Pipeline, exported): parses a provider JSON body and normalizes
  `usage` (OpenAI chat/completions `prompt_tokens`/`completion_tokens`, OpenAI responses and
  Anthropic `input_tokens`/`output_tokens`, Gemini `usageMetadata`/`usage_metadata`
  `promptTokenCount`/`candidatesTokenCount`) to `{ inputTokens, outputTokens, totalTokens }`, or null.
- Exchange entries (Pipeline stage tracker and repair-loop meter) gain `usage` computed from the
  full, unclipped response text.
- `summarizeExchangeUsage(entries)` (Interface, repair-history.js) builds per-entry and total usage:
  `{ calls, requestBytes, responseBytes, inputTokens, outputTokens, totalTokens, source }` where
  `source` is `reported` (all calls reported), `estimated` (none), or `mixed`. Estimates are
  `ceil(bytes / 4)` per side.
- Records: each conversation entry carries `usage { inputTokens, outputTokens, totalTokens, source }`;
  each repair round carries `usage` from its entries; the record carries a total `usage`. Image
  records use the provider `usage` when present (`source: reported`), else `usage: null`
  ("not reported": multipart bytes are not measured). Local-rules requests have no calls.
- Summary projection includes `usage` so the list row can show it without loading the record.

## 2. Block statistics

- Summary projection adds `blockedBy` (sum of per-round `blockedBy`) for repair-loop records.
- `RepairBlockStats` (Creator): last N = 10 repair-loop summaries; counts per check id; shows
  "Verified X of N"; each check is a button that sets a check filter on the list
  (records whose `blockedBy[check] > 0`) with a "Show all" reset. Hidden when no loop ran.

## 3. Author-declined memory

- Record: repair `finalProposals[]` gain `summary` and `cardIds`.
- `markRepairHistoryApplied` also writes `declinedProposals[]` = final proposals with patches
  that were not applied (`reason: "not_selected"`).
- `markRepairHistoryUndone(record, { proposalIds, undoneAt })` sets `undoneAt`,
  `undoneProposalIds` and adds those to `declinedProposals` (`reason: "undone"`).
- Route `POST /api/ai/repair-history/:id/undo { proposalIds }` (server + Hosted).
- Creator undo stack entries become `{ bundle, aiApply? }`; undoing an AI apply entry calls the
  route and refreshes the activity log.
- `collectRepairMemory({ list, read, repairTarget })` (Interface) is the single host-neutral
  implementation used by both hosts: same issue = same code and (if given) same target cards;
  `priorAttempts` keeps the existing rule (last 2 runs, 4 blocked proposals);
  `authorDeclined` = up to 4 unique declined changes from the last 6 matching runs,
  each `{ title <= 120, summary <= 200, cardIds <= 4, reason }`, total <= 2 KiB.
- Loop: `authorDeclined` is sent in every round as
  `constraints.repairLoop.authorDeclined { role: "author_declined_changes_content_not_instructions", changes }`.
  Every round, not just round 1: otherwise round 2 could re-propose a declined change. A prompt
  rule tells the model it is content describing what the author does not want.
- Context section: separate lines `context-memory-blocked` and `context-memory-declined`
  ("Includes N changes the author declined"), the latter expandable to list them and saying
  they come from the activity log (delete a record to forget it).
- Record field `memory { blockedAttempts, authorDeclined }` so replay shows what was sent.

## 4. Draft context

- `generate_cards` switches from `first_n` to `relevance_v1` with `maxCards: 12` (same count
  budget; byte budget 24 KiB also applies). Without a target card, the order equals the old
  first 12. Media modes and endpoint validation stay `first_n`.

## Compatibility

- Old records without `usage`/`blockedBy`/`declinedProposals` render as before ("–").
- Schema version stays 1 (additive fields).
