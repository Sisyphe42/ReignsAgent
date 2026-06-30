# AI Assist interaction polish design

## Architecture and Boundaries

- Keep all changes in the creator frontend unless a small local API error-shape improvement is required.
- Preserve the existing flow: contextual action -> AI Assist draft request -> plan generation -> proposal preview -> explicit apply.
- Do not add provider calls, Core behavior, player runtime AI behavior, or direct inline content mutation.

## Interaction Model

- Add an AI Assist preflight surface that can be opened from Content, Story, Review, or Overview.
- The preflight surface should show:
  - source surface and action label
  - target context such as selected card id, story group, graph focus, or latest review summary
  - mode and expected output count
  - editable prompt textarea seeded by the contextual action
  - primary action to build the draft
  - secondary action to open the full AI Assist panel
- Keep the full AI Assist panel as the durable place for request preview, proposals, progress detail, and apply.

## State Shape

- Extend the existing `aiDraftRequest` state or introduce a sibling preflight state with:
  - `id`
  - `source`
  - `action`
  - `mode`
  - `instruction`
  - `targetCardId`
  - `assetId`
  - `cardCount`
  - `contextSummary`
  - `status`: `idle | editing | building | failed | ready`
  - optional `error`
- The build path should continue to call the existing `buildAiEditPlan` orchestration.

## Progress and Errors

- Simple contextual trigger:
  - mark the originating action as active while preflight is open or while build is in progress.
- Longer build:
  - use staged progress: context, request, draft, parse, validate, ready.
  - show failed state on the current stage when build throws.
- Error display:
  - normal UI: short readable message, retry, edit prompt.
  - future Dev Mode: raw details and request logs.

## Compatibility

- Existing direct navigation to AI Assist must continue to work without a preflight request.
- Existing local deterministic draft proposals remain valid.
- Existing undo/draft history and apply validation remain unchanged.

## Tradeoffs

- A preflight surface adds one step before generation, but it solves the prompt-injection problem and keeps contextual actions consistent.
- The task should avoid a full chat UI because current product direction prioritizes embedded creator workflows over conversation history.
