# Complete AI Edit Module Implementation Plan

## Order

1. Pipeline contracts
   - Add AI context helpers, request builders, plan/proposal generation, fingerprinting, and patch application.
   - Export new functions and update export verifier list.
   - Add pipeline unit tests for text modes, media request modes, patch validation, asset upsert, and deterministic IDs.

2. Interface orchestration
   - Import pipeline AI helpers.
   - Add `buildAiEditPlan` and `applyAiEditPlan`.
   - Add tests for plan creation, proposal selection, stale fingerprint rejection, atomic apply, and validation errors.

3. Local API
   - Import new interface functions in `scripts/dev-server.mjs`.
   - Track the last diagnostics projection in `SessionState`.
   - Add `POST /api/ai/edit/plan` and `POST /api/ai/edit/apply`.
   - Replace the active editor only after successful apply.
   - Extend integration tests for plan/apply, media request preview, stale plan rejection, and unchanged connector plan.

4. Creator UI
   - Add `AI Edit` to `PANELS`.
   - Add state and handlers for latest diagnostics, plan, selected proposals, and apply result.
   - Add `AiEditPanel` with mode controls, context summary, proposal cards, patch preview, selection, apply, and navigation links.
   - Use `mutateEditor` for apply so undo/draft persistence are preserved.
   - Add CSS for AI Edit layout using existing panel, subsection, action-row, output, and badge patterns.

5. Docs and verification
   - Update README Creator dashboard section.
   - Run `npm run verify`.
   - Run `npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>`.
   - Smoke test local creator panel if verification passes.

## Risk Points

- Keep all patch application atomic; never mutate the active editor before validation.
- Keep generated text and tests free of Anti-RPG banned terms.
- Keep media modes request-only; do not add binary file writes or provider calls.
- Avoid introducing a shared contracts package; this task extends existing Pipeline/Interface boundaries.

## Rollback

- Pipeline helpers are additive and can be reverted without affecting Core/Reviewer.
- API routes are additive; existing routes must continue passing integration tests.
- UI panel is additive; if needed, remove the panel entry and component while preserving backend helpers.
