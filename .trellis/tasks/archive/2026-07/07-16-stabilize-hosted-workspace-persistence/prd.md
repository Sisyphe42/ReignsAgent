# Stabilize hosted workspace persistence

## Goal

Fix the Hosted Creator active-panel persistence race reported by PR 25 CI.

## Requirements

- Diagnose the failing PR 25 `hosted-creator-smoke` job from its GitHub Actions log.
- Preserve the Hosted OPFS serialized-write contract and continue asserting the physical `workspace.toml` contents.
- Ignore recoverable incomplete OPFS project directories while continuing to inspect every valid project's physical workspace file.
- Keep the post-persistence reload assertion so restoration remains covered.
- Wait for floating-rail scroll anchoring to settle before measuring icon stability; keep the strict sub-pixel geometry assertion.

## Acceptance Criteria

- [x] Both active-panel persistence checks tolerate a loaded Hosted runner while still failing when the expected TOML value never appears.
- [x] The formerly flaky navigation-density test passes repeated single-worker runs.
- [x] The complete Hosted browser suite and `npm run verify` pass.
- [x] GitHub Actions reports all PR checks green after the fix is pushed.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
