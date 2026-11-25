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

## Real model re-run after phase 3, 2026-11-24

- File: `real-deepseek-v4.1-flash-2026-11-24-r2.json`
- Command:
  `npm run eval:repair -- --real --endpoint http://127.0.0.1:3425/v1 --model auto/deepseek-v4.1-flash --k 3 --max-requests 60 --json scripts/repair-eval/results/real-deepseek-v4.1-flash-2026-11-24-r2.json`
- Same endpoint, model, 5 tasks and k = 3 as the first run. No key was sent.
- Code changes between the runs:
  - Producer-only edits are exempt from `scope` (`scope_exempt: adds_missing_producer`).
  - Text requests time out after 120 s instead of 60 s; the loop deadline is 300 s instead of 180 s.

| Metric | Run 1 (`…-2026-11-24.json`) | Run 2 (`…-2026-11-24-r2.json`) |
|---|---|---|
| Verified runs | 13/15 | 15/15 |
| pass@1 mean | 86.7 % | 100 % |
| Tasks with ≥ 1 success | 5/5 | 5/5 |
| Average rounds | 1.29 | 1.00 |
| Proposals evaluated / blocked | 17 / 4 | 15 / 0 |
| Blocked by check | scope = 4 | none |
| Requests sent (cap) | 21 (148) | 15 (60) |
| Timed-out requests | 4 (60 s limit) | 0 (120 s limit) |
| Completed-call duration: median / max | 24.7 s / 48.7 s | 18.8 s / 106.5 s |
| Completed calls over 60 s | 0 (anything slower was cut off) | 1 (court-gauge-pressure run 2, 106.5 s) |
| Average run / total wall time | 39.9 s / 12.2 min | 28.0 s / 7.0 min |
| Bytes sent / received | 607,091 / 334,536 | 521,334 / 318,921 |
| Tokens (prompt / completion / total) | 122,693 / 75,087 / 197,780 (17 calls) | 105,417 / 74,866 / 180,283 (15 calls) |

What changed in the answers:
- court-variable-gate:
  - In run 1, every first round put `riverToll` on `river-market` and was blocked by `scope`.
  - In run 2, all three runs again chose `river-market` (this time only the right choice). Each passed in round 1 via the producer exemption (48 → 72).
- court-gauge-pressure run 2 took 106.5 s. Under the old 60 s limit this request would have been cut off; in run 1 the same task lost a run to two timeouts.
- fog-unreachable: in run 1, run 2 needed 2 rounds (`scope` block on `clear-morning`, then dead-gate removal). In run 2, all three runs added a new producer card in round 1. No `gate_relaxed` advisories appeared in run 2.

Limits on attribution:
- Two variables changed at once (scope rule and timeouts), and each condition has only one run of 15. The model was sampled through a routing endpoint, so answers and latency vary between runs even at temperature 0.
- Directly attributable changes:
  - court-variable-gate: the same kind of answer was blocked in run 1 and passed in run 2, which is the scope change.
  - court-gauge run 2: the 106.5 s call would have hit the 60 s limit, which is the timeout change.
- Not attributable to either change: the fog-unreachable switch from a `clear-morning` edit to a new card, and the lower median latency. These may be run-to-run variation.

## Live capture (2026-11-25)

`live-capture-2026-11-25.json` is the key-free repair-history record of one live loop captured with
`node scripts/repair-eval/live-capture.mjs --endpoint http://127.0.0.1:3425 --model auto/deepseek-v4.1-flash --out <dir> --max-requests 3`
on the `fog-direct-fix` deck (sealed-warehouse unreachable). One real request was sent; the first round
was verified (55 → 78, about 44 s for the request). The record includes the logged conversation
(each message capped at 16 KiB). One run of one task: it shows the pipeline working live, not a success rate.

