# Verified repair loop for AI Assist

## Goal

Turn `repair_diagnostics` AI Assist from a single "propose -> author ticks" call into a bounded
evaluator-optimizer workflow: the model proposes, the Interface applies each proposal to a copy,
gates it on player validation, scores it with a fixed-seed Reviewer run, rejects shortcut fixes
(anti-reward-hacking), feeds structured failure reasons back for at most 3 rounds, and finally
still hands the proposals to the author for explicit per-proposal apply. Nothing is written
automatically.

Source brief: `D:\projects\portfolio\docs\portfolio-rebuild\references\reignsagent-repair-loop-brief-2026-11-24.md`.

## Requirements

1. Repair loop (repair mode only)
   - Reuse `createAiEditSuggestionsFromEndpoint`, `applyAiEditPatches`, `validatePlayerCards`, `runDiagnostics`.
   - Hard gate: player validation on the patched copy.
   - Deterministic scoring: fixed seed / cycles / maxTurns; same proposal -> same score.
   - Anti-cheat acceptance checks (target issue gone, no new errors, scope limits, no card removal or
     id change, no wiping gates, no zeroing effects, reachable cards not reduced, score not lower).
   - Stop conditions: first round with an accepted proposal, max rounds (<=3), deadline, byte budget,
     endpoint failure after round 1 (returns best round, status explicit). Round-1 endpoint failure
     surfaces as an error (no silent fallback).
   - Guardrails kept: baseFingerprint captured at loop start and checked at apply; editor never mutated
     during the loop; API keys never in request bodies, plan, or trace.
   - UI: per-round score progression and per-proposal evidence (which checks passed/failed),
     failed proposals listed but not pre-selected; English UI; existing visual style.
2. Context selection: replace "first 12 cards" with relevance-ordered selection (targets, diagnostic
   cards, graph neighbours / signal producers & consumers, rest) truncated by a byte budget; the
   selection reasons are visible in the request context.
3. Offline eval set: 5-10 cases on a local mock endpoint, reporting pass rate, average rounds,
   anti-cheat blocks; exposed as `npm run eval:repair` and covered by tests.
4. Optional: per-round request/response log with secrets masked.

## Constraints

- Branch `feat/repair-loop`, local commits only; no push / PR / issue.
- No new dependencies; no unrelated package.json edits.
- Never read or print real endpoint configuration or keys; eval uses mocks only.
- Module boundaries per AGENTS.md (Interface wires Pipeline + Reviewer; Pipeline must not import Reviewer).

## Acceptance Criteria

- [ ] `buildVerifiedRepairPlan` returns `verification` with rounds, checks, before/after scores, stop reason.
- [ ] Shortcut fixes (wipe requirements, delete/rename card, zero effects, off-scope edits, new errors,
      player-invalid cards) are rejected with named checks; unit tests for each.
- [ ] Same input -> identical verification output (deterministic).
- [ ] Context selection unit tests: relevant card beyond index 12 is included; budget truncation works.
- [ ] `npm run eval:repair` prints pass rate, average rounds, blocked count; integration test asserts expected outcomes.
- [ ] Creator Server integration test runs the loop against a mock endpoint and applies a verified proposal.
- [ ] `npm run verify` passes; `npm run test:hosted` passes; build:game smoke passes.
