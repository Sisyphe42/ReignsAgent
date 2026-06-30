# Review diagnostics visual polish implementation

## Steps

1. Inspect current `ReviewPanel`, `NarrativeCoverage`, warning rendering, and card focus flow.
2. Pass `editor` and `onFocusCard` into `ReviewPanel` from `App`.
3. Add local Review helpers for card lookup, card coverage rows, warning targets, rates, and labels.
4. Add a segmented section state for Overview / Coverage / Story / Issues.
5. Implement Overview metrics and gauge pressure visualization.
6. Implement Coverage rows with visit/cycle bars and unvisited/low-cycle states.
7. Enhance Story coverage display with ending and issue details where existing diagnostics allow.
8. Replace the warning list with issue cards, target chips, Content focus, Story link, and warning-scoped AI Repair.
9. Add CSS for Review dashboard sections, bars, chips, issue cards, and responsive behavior.
10. Update specs only if a new reusable frontend contract emerges.

## Validation

- `npm run verify`
- `npm run build:game -- fixtures/content/oss-court.cards.json output/tmp-review-visuals-build`
- Playwright smoke:
  - open `/workbench/review`
  - enable AI Assist
  - run Review
  - verify overview metrics render
  - verify Coverage cards and status chips render
  - verify Story groups/ending coverage render
  - verify Issues cards render
  - click a card target and confirm Content opens focused on that card
  - click issue AI repair and confirm AI Assist preflight opens with scoped warning prompt
  - assert browser console errors are 0

## Rollback

- Revert ReviewPanel and CSS changes.
- Keep previous AI Assist preflight and top-level Review AI actions intact.
