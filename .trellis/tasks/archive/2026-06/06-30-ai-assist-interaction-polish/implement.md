# AI Assist interaction polish implementation

## Steps

1. Inspect current AI Assist state flow in `apps/creator-web/src/main.jsx`.
2. Add or extend shared AI Assist request/preflight state.
3. Replace direct contextual action routing with preflight open behavior.
4. Build a reusable preflight UI component with action summary, target context, editable prompt, mode, and build/open controls.
5. Wire Content, Story, Review, and Overview actions through the shared preflight model.
6. Add compact active/loading visual state to action strips.
7. Improve `AiProgress` to include completed, active, failed, and ready states.
8. Add build error state with retry and edit prompt actions.
9. Keep proposal apply flow unchanged.
10. Update `.trellis/spec/frontend/ai-edit-contracts.md` if the state contract changes.

## Validation

- `npm run verify`
- `npm run build:game -- fixtures/content/oss-court.cards.json output/tmp-ai-assist-polish-build`
- Frontend smoke:
  - enable AI Assist from header
  - Content action opens preflight with selected-card context
  - Story action opens preflight with graph/story context
  - Review repair is disabled before Review and opens preflight after Review
  - prompt can be edited before build
  - build shows staged progress and proposal preview
  - retry/error UI can be forced or smoke-tested through a mocked failure path
  - apply path still validates and updates through existing proposal flow

## Risk Points

- `apps/creator-web/src/main.jsx` is large and single-file; keep changes local and avoid broad component extraction.
- Contextual action state must not bypass `buildAiEditPlan` or `applyAiEditPlan`.
- Visible motion should be restrained and skin-compatible.

## Rollback

- Revert the preflight component and route contextual actions back to the current `openAiAssistDraft()` path.
- Leave the existing AI Assist panel and settings shell intact.
