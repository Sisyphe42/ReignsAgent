# Design

## Boundaries

All changes are Creator Web presentation (`apps/creator-web`) plus tests and the demo script. No Core, Reviewer, Pipeline, or contract change: the failure `code`, `stage`, and the repair-loop `verification` (`selectedRound`, `roundsUsed`, `limits.maxRounds`, `agentStop.round`) already carry everything the copy needs.

## New pure module: `apps/creator-web/src/ai-status-copy.js`

No React, no DOM, importable from `test/integration` with plain Node.

- `toSentence(text)` / `joinSentences(...parts)`: trim and drop trailing `.`, `!`, `?`, `。` before adding exactly one period, so composed text never shows `..`. A trailing ellipsis (`…` or `...`) is kept.
- `httpStatusOf(failure)`: explicit `status`, else `status NNN` in the message.
- `describeAiFailure({ code, message, stage, stepLabel, loop })` → `{ kind, tone, title, text, actions }`
  - `cancelled` (`ai_cancelled` or "cancelled by the author"): tone `neutral`, title "Cancelled", text names the interrupted round, says finished rounds stay in the repair history and no card changed; actions `rebuild`, `edit`.
  - `unavailable` (5xx, 429, `endpoint_network_error`, `endpoint_timeout`, `endpoint_response_limit`): title "Endpoint unavailable", advice to wait and retry, explicitly not the prompt; actions `retry`.
  - `limit` (`ai_session_budget`): title "Request limit reached", message only (it already says what to do); actions `settings`.
  - `config` (401/403/404, missing key/model): title "Endpoint rejected the request", advice to check Settings; actions `settings`, `retry`.
  - `prompt` (other 4xx, parse / invalid response / prevalidation): title "Draft failed", advice "Edit the prompt or retry."; actions `retry`, `edit`.
  - fallback: "Draft failed" with the old generic advice.
- `repairStopLabel(verificationLike)`: returns the stop sentence with explicit round numbers, e.g. "Passed in round 2 of 3: the first proposal that cleared every blocking check." Works for live `verification` and stored history records (`selectedRound`, `rounds.length`, `limits.maxRounds` or `maxRounds`).

## UI wiring (`main.jsx`)

- `progressStatus` gains `"cancelled"`. `AiProgress` marks the interrupted step `ai-progress__step--cancelled`; `RepairLoopProgress` uses `--cancelled` classes and "Cancelled during …" text.
- `buildError` string becomes a `buildNotice` object rendered as `.ai-build-notice.ai-build-notice--{tone}` (error tone keeps `.ai-build-error` for existing selectors); `role="alert"` only for errors, `role="status"` for cancel.
- Image cancel is detected from the aborted signal and uses the same cancelled notice.
- Repair instruction built from an issue uses `toSentence(issue.message)`.

## Narrow navigation (`styles.css`)

At `max-width: 800px` the rail becomes a horizontally scrolling tab strip: items are `width: auto; min-width: max-content`, icon in flow, index meta hidden, label never ellipsized, state badge compact. Phantom overrides are re-declared at higher specificity so its fixed 148–168 px tabs no longer clip. The active tab is scrolled into view on panel change.

## Rollback

Each concern is a separate commit; reverting one does not affect the others.
