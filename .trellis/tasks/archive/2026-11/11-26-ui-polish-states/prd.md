# UI polish: cancel/endpoint/repair-loop states, narrow nav

## Goal

Continue the authorized Creator UX fixes found in the portfolio screenshot review: states that look like errors when they are not, advice that does not match the failure, an ambiguous repair-loop subtitle, truncated navigation at phone width, and punctuation glitches in error text.

## Requirements

1. **Cancel is not a failure.** After the author presses Cancel on an AI Assist draft or repair loop, the panel shows a neutral notice (not the error red) titled "Cancelled". It says that rounds already finished are kept in the repair history and that no card was changed, and offers a "Build again" entry point. The progress step / repair-loop phase that was interrupted is shown as cancelled (neutral), not failed (red).
2. **Advice matches the failure type.**
   - 5xx, network, timeout, 429/overloaded: suggest retrying later and say the endpoint is temporarily unavailable; do not suggest editing the prompt.
   - 4xx (other than 429), parse / invalid-response / prevalidation failures: suggest editing the prompt (or the endpoint settings for 401/403/404).
   - Session request limit: suggest raising the limit in Settings or restarting the Creator; do not suggest editing the prompt or retrying immediately.
3. **Repair-loop subtitle names the round.** The "verified" stop reason reads like "Passed in round 2 of 3: the first proposal that cleared every blocking check." Other stop reasons that refer to a round also name it explicitly (round limit, endpoint drop, model stop, best-round fallbacks).
4. **390 px navigation is readable.** At narrow widths the rail is a horizontally scrolling tab strip of icon + full label (+ state badge); no label is ellipsis-truncated and the page does not scroll horizontally. Applies to every skin, including Phantom.
5. **No doubled punctuation** in error/status text (for example the session-limit message "…restart the Creator.." produced by appending a sentence to a message that already ends with a period). Sweep the error/status text for doubled punctuation.

## Constraints

- AI only through mocks; no keys read or written.
- Module boundaries per AGENTS.md (UI classification lives in creator-web; no Electron imports; no Core changes).
- Do not touch `D:\projects\portfolio` except the handoff file.

## Acceptance Criteria

- [ ] Cancel shows a neutral "Cancelled" notice with a Build again action; `ai-progress` / repair-loop phase carry a cancelled (not failed) state. Browser test.
- [ ] HTTP 503 / network / timeout show retry-later advice without "Edit the prompt"; 4xx/parse show edit-prompt advice; session limit shows Settings advice. Unit tests (+ browser 503 check).
- [ ] Repair-loop subtitle names the passing round ("Passed in round N of M"). Unit + browser test.
- [ ] At 390 px no rail label is truncated and `scrollWidth <= innerWidth`, in default and Phantom skins. Browser test.
- [ ] No ".." in session-limit or composed error text. Unit test.
- [ ] `npm run verify`, `npm run test:hosted`, `npm run eval:repair` pass.
