# UX fixes and agent visibility

Source brief: `D:\projects\portfolio\docs\portfolio-rebuild\references\reignsagent-ux-agent-brief-2026-11-25.md`
(goal mode, user-authorized product changes). Evidence of the defects:
`D:\projects\portfolio\work\product-evidence\reignsagent-ui-states-2026-11-25\README.md`.

## Requirements

### R1 Interface fixes
- Review running: show real progress (completed/total simulated cycles, then the summarize phase); Run review is disabled while running.
- Tablet width (~834 px): dedicated layout. Issue/risk rows must not collapse into one word per line; the top bar must not stack into three rows. 768 and 390 stay the same or improve.
- Empty deck: a real empty state (what to do next, one primary and one secondary action), distinct from "No cards match the current filters".
- Phantom skin: small labels reach WCAG AA body-text contrast (>= 4.5:1); the diagonal red band no longer runs over text.
- Repair popover: "Configured" (and similar metric values) must not break mid-word.
- Light skins: inputs/panels must not turn grey because of `color-mix(..., #000)` (global style fix).

### R2 Real AI progress
- The six AI Assist steps (Context / Request / Local draft / Parse / Validate / Ready) reflect real backend stages instead of a 90 ms animation.
- Repair loop: show "Round r/3" and the current stage (requesting / trial apply / scoring / checks).
- On failure, the bar stops at the step that really failed.

### R3 Which cards the AI saw
- Show the request's context card selection (`context.bundle.cardSelection`): per card the reason tier (target / diagnostic / neighbour / other) and reason text; the number of omitted cards and why (count limit / byte budget). Collapsed by default, expandable. English UI, existing visual style.

### R4 Repair history replay
- Every repair-loop run leaves one record: time, target issues, per-round proposal summaries, scores, which check blocked a proposal and why, final status, and which proposals the author finally applied.
- Stored in project-local data, never containing keys. Bounded count and size with pruning; author can delete one or clear all.
- UI lists records and expands one to replay each round.

## Constraints
- Branch `feat/ux-agent-visibility` only; no push, no PR/issue.
- No real AI requests; mock endpoints only. No secrets read/printed.
- Module boundaries per AGENTS.md (Core stays untouched; Reviewer stays headless; browser persistence stays in `apps/creator-web`).

## Acceptance
- `npm run verify`, `npm run test:hosted`, offline `npm run eval:repair` pass.
- New unit / integration / browser tests cover progress events, card-selection omissions, history storage limits, history API, and the new UI states.
- Handoff written to `D:\projects\portfolio\docs\portfolio-rebuild\references\reignsagent-ux-agent-handoff-2026-11-25.md`.
