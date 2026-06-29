# Complete AI Edit Module Design

## Architecture

AI Edit is a creator-side orchestration feature. It must not move game rules into the frontend, and it must not call external AI providers in this task.

- `packages/pipeline` owns request construction, AI context packaging, deterministic offline suggestions, and bundle patch application.
- `packages/interface` owns plan/apply orchestration against an in-memory editor.
- `scripts/dev-server.mjs` exposes local API routes and replaces session editor state only after an apply succeeds.
- `apps/creator-web` owns the creator workflow UI.

Core and Reviewer stay unchanged.

## Contracts

### AI Context

`buildAiContext` returns a JSON-safe object that can be included in text, image-generation, or image-analysis requests:

- `project`: durable ReignsAgent usage guidance, binary left/right rule, Anti-RPG constraints, data-driven tags/variables, and response expectations.
- `instruction`: the creator's instruction as entered in AI Edit.
- `selection`: selected `targetCardIds`, selected card summaries, target asset if any, and existing assets linked to selected cards.
- `bundle`: high-level metadata, card count, asset count, tag labels, presentation gauge labels, and compact relevant cards.
- `diagnostics`: supplied review projection and feedback summary when mode needs it.
- `constraints`: connector/request constraints, style hints, and output limits.

### Requests

- `buildCardEditRequest` creates `purpose: "card_edit"` requests for `generate_cards` and `repair_diagnostics`.
- `buildMediaEditRequest` creates `purpose: "card_asset_generation"` for `generate_asset` and `purpose: "card_asset_analysis"` for `analyze_asset`.
- Requests include stable `requestId`, `responseFormat: "json"`, a mode-specific `schema`, and the full AI context.

### Plans And Proposals

`createAiEditSuggestions` returns:

- `schemaVersion: 1`
- `baseFingerprint`
- `mode`
- `config`
- `request`
- optional `feedback`
- `proposals`

Each proposal has `id`, `title`, `summary`, `source`, `target`, `patches`, and optional `preview`. Patch operations are restricted to:

- `addCard { card }`
- `updateCard { cardId, changes }`
- `setChoiceLabel { cardId, choiceId, label }`
- `setChoiceEffects { cardId, choiceId, effects }`
- `setMetadata { metadata }`
- `upsertAsset { asset }`

### Apply

`applyAiEditPatches` applies patches to a cloned content bundle, validates through `createContentBundle`, and returns the next bundle plus validation. `applyAiEditPlan` filters proposals by selected IDs, checks `baseFingerprint` against the active editor, applies all selected patches atomically, then returns the next editor bundle and validation results.

## Offline Modes

- `generate_cards`: deterministic stub card drafts based on connector config theme/count/instruction; generated cards must have unique IDs and binary left/right choices.
- `repair_diagnostics`: converts unambiguous `createDiagnosticFeedback` actions into patches:
  - low coverage -> increase target card `weight`
  - unreachable/never visited -> relax target card requirements when present
  - missing required tags -> add tag producer to selected card or first existing card
  - stalled cycles -> add a fallback always-eligible card
  - dominant gauge pressure -> dampen choice effects that push the target gauge too far
- `generate_asset`: request-preview proposal with an `upsertAsset` placeholder record only if a target card exists; no binary file work.
- `analyze_asset`: request-preview proposal with no mutation patches; it previews the requested structured analysis only.

## UI Flow

Add `AI Edit` between Review and Preview in the Creator rail.

- Controls: mode select, provider/theme/style/count, target card select, optional asset select, instruction textarea.
- Context summary: current card count, diagnostics availability, selected card/asset, and included context types.
- Actions: build plan, select proposals, apply selected, open Content, open Review.
- Repair mode without diagnostics shows a Review link and disables plan generation.
- Apply uses the existing `mutateEditor` path so undo and local draft persistence work.

## Compatibility

- No content schema migration.
- Existing `/api/connector/plan` remains unchanged.
- Existing build/player output remains unchanged except when a user applies AI Edit proposals to content.
- Media modes are interface-ready but provider execution remains out of scope.
