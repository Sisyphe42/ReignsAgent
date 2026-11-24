# Design: verified repair loop

## Placement

- `packages/interface/src/repair-loop.js` (new, exported via `packages/interface/src/index.js`):
  the loop, the evaluator and the feedback builder. Interface is the only module that may wire
  Pipeline and Reviewer together.
- `packages/pipeline/src/index.js`: relevance-based context card selection
  (`selectAiContextCards`), repair-loop editor rule, `repairLoop` constraints passed through
  `config.constraints` (no new request shape).
- `apps/creator-server/src/server.mjs` + `apps/creator-web/src/browser-backend.js`:
  `POST /api/ai/edit/plan` with `mode: "repair_diagnostics"` runs the verified loop unless
  `verify: false`. Optional `repairTarget: { code, cardIds, tags, variables, factions }`.
- `apps/creator-web/src/main.jsx`: verification summary + per-proposal evidence + request log.
- `scripts/eval-repair-loop.mjs` + `scripts/repair-eval/cases.mjs`: offline eval on a local mock endpoint.

## Loop

```
fingerprint0 = fingerprint(editor)            // the plan's baseFingerprint
baseline     = runDiagnostics(cards, SCORING) // seed 1, 500 cycles, 40 turns
targets      = repairTarget ?? error-level warnings ?? all warnings
for round in 1..maxRounds (<=3):
  check deadline / budget
  plan_r = endpoint call (metered fetch: bytes, duration, AbortSignal deadline)
           constraints.repairLoop = { round, targets, acceptanceRules, previousAttempts }
  verdicts = proposals.slice(0, maxProposalsPerRound).map(evaluate)
  if any verdict.passed -> stop "verified"
  feedback = compact failed checks (<= feedbackBytes)
stop -> best round (most passed; then most passed checks; then highest score)
```

Offline (no endpoint): one round of the deterministic rule-based repair; re-asking gives the same
answer, so stop reason is `offline_single_round`.

## Acceptance checks (per proposal, on a copy)

Blocking:
- `patches_apply` – patches apply, bundle validation passes.
- `allowed_ops` – only addCard / updateCard / setChoiceLabel / setChoiceEffects, <= maxPatches.
- `player_valid` – `validatePlayerCards` hard gate.
- `card_ids_preserved` – every original card id still exists; no `changes.id`.
- `target_resolved` – each targeted issue entity (code + card/tag/variable/faction) is gone.
- `no_new_errors` – no new error-level issue entity appears.
- `scope` – edited existing cards are within the related set (targets, graph neighbours, cards that
  produce/consume the involved signals) and at most `maxEditedCards`.
- `gates_preserved` – no requirement atom removed from existing cards except the specific
  unsatisfiable atom named by the targeted issue (that exception is reported as advisory).
- `effects_preserved` – existing choices keep every tag/variable producer and >= 50 % of their total
  absolute gauge delta.
- `reachability_kept` – no originally reachable card becomes unreachable.
- `score_not_lower` – health score after >= before.

Advisory (shown, not blocking): `gate_relaxed`, `new_warnings`, `stalled_rate`.

Why not just the health score: wiping requirements makes cards reachable and raises the score;
zeroing gauge deltas lowers the game-over rate, which `computeHealthScore` rewards. Those are
exactly the shortcuts the checks name.

## Budgets

`maxRounds` 3 (hard cap 3), `maxProposalsPerRound` 6, `maxPatchesPerProposal` 8,
`maxEditedCards` 4, `maxRequestBytes` 256 KiB per round, `maxResponseBytes` 512 KiB per round
(pipeline ceiling 1 MiB still applies), `maxTotalBytes` 2 MiB, `deadlineMs` 180 s overall,
`feedbackBytes` 6 KiB. Token estimate = bytes / 4 (reported, not enforced).

## Context selection

Tiers (stable document order within a tier): `target` (selected + repair targets) ->
`diagnostic` (cards named by warnings, errors first) -> `neighbour` (graph edges to/from tier-0/1
cards, producers/consumers of their signals and of issue tags/variables) -> `other`.
Truncate at `maxCards` 40 and `budgetBytes` 24 KiB of compact JSON; always keep the first target
card. Context carries `bundle.cardSelection = { strategy, included, omitted, budgetBytes, reasons }`.

## Compatibility

- Plan shape is additive (`verification`, `proposal.verification`).
- `applyAiEditPlan` unchanged for non-verified plans; for verified plans it additionally refuses a
  selected combination that fails player validation (`ai_repair_player_invalid`).
- Rollback: revert the branch commits; no data migration.
