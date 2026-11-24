# Repair-loop eval results

## Real model, 2026-11-24

- File: `real-deepseek-v4.1-flash-2026-11-24.json` (full report: per run status, rounds, blocked checks with details, the model's proposal titles/summaries/patch summaries, response excerpts, timing, bytes, token usage).
- Command:
  `npm run eval:repair -- --real --endpoint http://127.0.0.1:3425/v1 --model auto/deepseek-v4.1-flash --k 3 --max-requests 148 --json scripts/repair-eval/results/real-deepseek-v4.1-flash-2026-11-24.json`
- Endpoint: a local OpenAI-compatible router on loopback; no API key was set, read, or sent. Model `auto/deepseek-v4.1-flash` (a reasoning model; ~2–8k reasoning tokens per answer).
- Product defaults were used unchanged: 60 s per request, 180 s per loop, 3 rounds, fixed scoring (500 cycles, 40 turns, seed 1).
- In real mode the model only received the broken deck, the target issue and the same instruction the Creator UI builds. The scripted answers were never sent.
- Tasks: 5 distinct deck/target pairs × k = 3. Skipped: `fog-gate-wipe-then-fix` and `fog-persistent-shortcuts` (same deck and target as `fog-direct-fix`), `fog-rejected-response` and `fog-endpoint-drop` (scripted failure injection).
- Requests: 21 for the run (cap 148), plus 2 for a 1-run pilot of `fog-unreachable` beforehand (not in the JSON; it hit one 60 s timeout, retried, and verified in 1 round at 55 → 79).

| Task | Verified / runs | Rounds per run | Notes |
|---|---|---|---|
| fog-unreachable | 3/3 | 1, 2, 1 | Run 2: round 1 put the producer on `clear-morning` (blocked by `scope`); round 2 removed only the dead `quarantineLifted` gate (passed, advisory `gate_relaxed`). |
| fog-missing-tag | 3/3 | 1, 1, 1 | Each run added a new card that produces `quarantineLifted`. |
| court-gauge-pressure | 2/3 | 1, –, 1 | Run 2: endpoint timed out twice (first attempt and the retry), so it was recorded as an error. Passing runs rebalanced gauge1 across 3–4 choices (72 → 75). |
| court-variable-gate | 2/3 | 2, 2, 2 | In all 3 runs, round 1 added `riverToll` to `river-market` (blocked by `scope`). Run 1's round 2 timed out (`endpoint_error`, unverified). Run 2 added a new producer card (48 → 78). Run 3 removed the dead gate (48 → 79, advisory `gate_relaxed`). |
| night-watch-stall | 3/3 | 1, 1, 1 | Each run added repeatable fallback card(s) (67 → 100). |

Summary:
- pass@1 mean: **86.7 %** (13/15 runs verified).
- Tasks with at least one success: **5/5**.
- Average rounds: **1.29** (over the 14 runs that produced rounds).
- Proposals evaluated: 17. Blocked: 4, all by `scope`. Rejected responses: 0. Endpoint-error rounds: 1.
- Errored runs: 1. Runs retried after a timeout: 2.
- Average run: 39.9 s. Total: 12.2 min.
- Bytes sent / received: 607,091 / 334,536.
- Tokens (as reported by the endpoint, 17 calls): prompt 122,693; completion 75,087; total 197,780.

What this shows:
- The model **never** wiped a satisfiable gate, deleted or renamed a card, zeroed effects, or produced a one-sided card in these 15 runs.
- The only block was `scope`. Three times the model added the missing producer to an existing card outside the "related" set. That is arguably a legitimate fix, so `scope` is stricter than necessary for missing-producer issues.
- After a `scope` block, the model twice switched to removing the unsatisfiable requirement. This is the one removal the rules allow, and it is reported as the advisory `gate_relaxed`.
- Timeouts mattered: 4 of 21 requests hit the 60 s per-request limit (court-gauge run 1 first attempt, both attempts of court-gauge run 2, court-variable run 1 round 2).

## Offline harness eval

`npm run eval:repair` (scripted mock answers; measures the harness, not a model) is covered by `test/integration/repair-eval.test.js`.
