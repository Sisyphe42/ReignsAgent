# Review diagnostics visual polish

## Goal

Improve the Review page into a dense narrative QA dashboard for non-technical content authors. The page should explain review health, coverage, story group status, and concrete repair targets before AI generates fixes.

## Requirements

- Keep all work on PR #18 / `feature/ai-assist-ux`.
- Create a frontend-first visual polish pass using existing diagnostics data.
- Do not change Core, Reviewer, deployable player behavior, or the AI backend.
- Upgrade the Review top summary to show health score, sample size, average turns, game-over rate, stalled rate, and warning counts.
- Add Review subviews or segmented sections for Overview, Coverage, Story, and Issues.
- Coverage should show card visit/cycle bars, unvisited cards, and low-cycle cards.
- Story should show enhanced story group coverage, ending coverage, unreachable/unvisited details, and issue counts.
- Issues should show warning cards with severity, target chips, and actions.
- Add Review target actions that can open Content focused on the relevant card.
- Keep AI Assist actions, and add issue-level repair prompts using selected warning/group/card context.
- Use existing style tokens and skin variables. The UI should be compact and operational, not marketing-like.

## Acceptance Criteria

- [ ] Running Review renders compact summary metrics from existing diagnostics fields.
- [ ] Coverage view renders card visit/cycle rates and clearly marks unvisited and low-cycle cards.
- [ ] Story view renders group/ending coverage and exposes unreachable/unvisited details.
- [ ] Issues view renders warning cards with target chips.
- [ ] Clicking a card target opens Content focused on that card.
- [ ] Issue-level AI Repair opens AI Assist preflight with warning-specific context and prompt.
- [ ] No Core, Reviewer, Pipeline provider, player runtime, or public API schema changes are introduced unless proven necessary.
- [ ] `npm run verify` passes.
- [ ] Player build still passes with `npm run build:game -- fixtures/content/oss-court.cards.json output/tmp-review-visuals-build`.
- [ ] Playwright smoke covers Review run, summary metrics, coverage/status rendering, Content focus, AI repair preflight, and zero console errors.

## Notes

- Public interfaces should remain stable. Prefer local Creator UI helpers over package-level API additions.
