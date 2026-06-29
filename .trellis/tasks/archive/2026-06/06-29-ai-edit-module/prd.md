# Complete AI Edit Module

## Goal

Implement the offline AI Edit creator module so content creators can request AI-style drafting or review-driven repair suggestions, preview explicit patches, and apply selected proposals to the current card bundle without any real provider call. The module must also reserve typed request/proposal interfaces for future image generation and image analysis workflows.

## Confirmed Facts

- The Creator workspace is the Vite/React app in `apps/creator-web`; README says it is the primary creator UI during development.
- The local backend API lives in `scripts/dev-server.mjs` and currently exposes editor, diagnostics, connector plan, play, and build routes.
- `packages/pipeline` already owns content validation, connector request construction, and reviewer feedback actions.
- `packages/interface` already coordinates editor state, diagnostics projection, connector config/plans, preview sessions, and build preparation.
- Content assets are currently flexible records with `id`, optional `cardId`, optional `uri`, and metadata such as `title`, `sourceUrl`, `license`, and `attribution`.
- Core and Reviewer must stay headless and unchanged for this feature.
- The implementation must preserve the Anti-RPG boundary: no built-in inventory, equipment, shop, rarity, crafting, class, skill tree, loot, or resource-management loops.
- User approved the default review behavior: AI Edit consumes the latest Review result and directs creators to the Review panel when no diagnostics are available.

## Requirements

- Add offline AI Edit contracts in Pipeline:
  - `buildAiContext({ bundle, instruction, targetCardIds, diagnostics, constraints, assets, mode })`
  - `buildCardEditRequest({ bundle, instruction, targetCardIds, diagnostics, constraints })`
  - `buildMediaEditRequest({ bundle, mode, instruction, targetCardId, assetId, style, diagnostics, constraints })`
  - `createAiEditSuggestions({ bundle, mode, config, instruction, targetCardId, diagnostics })`
  - `applyAiEditPatches({ bundle, patches })`
- Define an `AiEditPlan` shape with `schemaVersion`, `baseFingerprint`, `mode`, `config`, `request`, optional `feedback`, and `proposals`.
- Restrict proposal patch operations to bundle-safe edits: `addCard`, `updateCard`, `setChoiceLabel`, `setChoiceEffects`, `setMetadata`, and `upsertAsset`.
- AI context must explicitly include project usage guidance, pure left/right gameplay rules, schema expectations, current user instruction, selected cards/assets, tag/gauge labels when available, diagnostics when supplied, and response expectations.
- Add Interface orchestration exports:
  - `buildAiEditPlan({ editor, config, mode, instruction, targetCardId, diagnostics })`
  - `applyAiEditPlan({ editor, plan, proposalIds })`
- Add local API routes:
  - `POST /api/ai/edit/plan`
  - `POST /api/ai/edit/apply`
- Add an `AI Edit` panel to the Creator rail. The panel must support draft-card generation, reviewer-diagnostic repair, asset-generation request preview, and asset-analysis request preview. It must show proposal source/targets/patch preview, context summary, allow selecting proposals, apply selected proposals, and link back to Content and Review.
- `generate_asset` and `analyze_asset` modes are request-ready only in this task: they produce structured requests/proposals but do not call providers or write binary image files.
- Applying proposals must be atomic: compare the plan fingerprint, apply patches to a cloned bundle, validate the result, and replace the server editor only if validation passes.
- Applied AI edits must participate in the existing undo and local draft persistence flow.
- Update README Creator dashboard documentation.

## Acceptance Criteria

- [ ] `generate_cards` produces deterministic valid draft-card proposals with unique IDs and binary left/right choices.
- [ ] `repair_diagnostics` converts unambiguous reviewer feedback into patchable proposals for low coverage, unreachable gates, missing tag producers, stalled cycles, and dominant gauge pressure.
- [ ] `generate_asset` and `analyze_asset` produce structured context-rich request previews that include relevant card/asset context and response expectations.
- [ ] Invalid patches and stale plan fingerprints are rejected without mutating the active editor.
- [ ] The Creator UI can build a plan, preview/select proposals, apply selected proposals, and refresh the editor state.
- [ ] The Creator UI routes creators to Review when repair mode has no diagnostics instead of running diagnostics inside AI Edit.
- [ ] Existing `/api/connector/plan` behavior remains unchanged.
- [ ] Unit and integration tests cover Pipeline, Interface, and local API behavior.
- [ ] `npm run verify` passes.
- [ ] `npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>` passes.

## Out Of Scope

- Real LLM/provider SDK calls.
- Secret storage or API key management.
- Binary image generation, upload, download, file persistence, or image recognition execution.
- Content schema migration.
- Any built-in RPG management concepts.
