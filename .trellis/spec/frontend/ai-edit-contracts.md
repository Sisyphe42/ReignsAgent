# AI Assist Contracts

## Scenario: AI Assist Local Draft Flow

### 1. Scope / Trigger

- Trigger: AI Assist spans Pipeline request/proposal contracts, Interface editor orchestration, local API routes, and Creator UI state.
- Scope: local proposal generation, review repair proposals, visual request previews, patch preview, contextual creator entry points, and atomic apply.
- Boundary: no external provider calls, no secret storage, no binary image persistence, and no Core or Reviewer mutation.

### 2. Signatures

- Pipeline:
  - `buildAiContext({ bundle, instruction, targetCardIds, diagnostics, constraints, assets, mode })`
  - `buildCardEditRequest({ bundle, instruction, targetCardIds, diagnostics, constraints })`
  - `buildMediaEditRequest({ bundle, mode, instruction, targetCardId, assetId, style, diagnostics, constraints })`
  - `createAiEditSuggestions({ bundle, mode, config, instruction, targetCardId, assetId, diagnostics })`
  - `applyAiEditPatches({ bundle, patches })`
- Interface:
  - `buildAiEditPlan({ editor, config, mode, instruction, targetCardId, assetId, diagnostics })`
  - `applyAiEditPlan({ editor, plan, proposalIds })`
- Creator UI:
  - `openAiAssistDraft({ mode, instruction, targetCardId?, assetId?, cardCount?, theme? })`
  - `AiAssistPanel({ draftRequest })`
- Local API:
  - `POST /api/ai/edit/plan`
  - `POST /api/ai/edit/apply`

### 3. Contracts

- Plan response:
  - `schemaVersion: 1`
  - `baseFingerprint`: stable fingerprint of the active content bundle
  - `mode`: one of `generate_cards`, `repair_diagnostics`, `generate_asset`, `analyze_asset`
  - `config`: JSON-safe connector descriptor or preview settings
  - `request`: context-rich request preview with `purpose`, `responseFormat`, `schema`, and `context`
  - `feedback`: optional reviewer feedback action summary
  - `proposals`: array of proposal records
- Proposal response:
  - `id`, `title`, `summary`, `source`, `target`, `patches`, optional `preview`
- Allowed patch operations only:
  - `addCard { card }`
  - `updateCard { cardId, changes }`
  - `setChoiceLabel { cardId, choiceId, label }`
  - `setChoiceEffects { cardId, choiceId, effects }`
  - `setMetadata { metadata }`
  - `upsertAsset { asset }`
- Visual modes are request previews. They may create JSON asset placeholders but must not generate, upload, download, or inspect binary files in this pass.
- Contextual actions in Content, Story, and Review are routing helpers only. They may enable AI Assist, open the AI Assist panel, and prefill mode/instruction/target fields, but must not call providers or mutate cards directly.

### 4. Validation & Error Matrix

- Unknown mode -> `PipelineError` or API JSON error.
- Unsupported patch operation -> `PipelineError`; active editor must remain unchanged.
- Patch references a missing card or choice -> `PipelineError`; active editor must remain unchanged.
- `repair_diagnostics` without latest Review result in local API -> JSON error with `code: "diagnostics_required"`.
- Review contextual repair action without latest diagnostics -> disabled UI action; if bypassed, local API still returns `diagnostics_required`.
- `plan.baseFingerprint` differs from active editor fingerprint -> `InterfaceError`; active editor must remain unchanged.
- Patch result fails content bundle validation -> error before the server replaces `store.editor`.

### 5. Good/Base/Bad Cases

- Good: Creator runs Review, builds `repair_diagnostics`, previews patches, selects one proposal, and apply replaces the editor through the normal mutation path.
- Base: Creator builds `generate_cards`; deterministic stub cards have unique ids and exactly left/right choices.
- Base: Creator builds `generate_asset` or `analyze_asset`; UI shows request context and proposal preview without provider execution.
- Base: Creator triggers a Content, Story, or Review contextual action; the AI Assist panel opens with a scoped prompt and waits for explicit plan generation.
- Bad: Creator applies an old plan after editing content; apply is rejected as stale and no content is replaced.
- Bad: Proposal contains an unsupported patch operation; validation rejects the proposal and no partial edit is stored.

### 6. Tests Required

- Pipeline unit tests:
  - Request/context contains project guidance and selected card/asset context.
  - Generated card proposals are deterministic and player-shape compatible.
  - Repair proposals cover low coverage, unreachable gates, missing tag producers, stalled runs, and dominant gauge pressure where unambiguous.
  - Patch application validates output and rejects unsupported operations.
  - Visual request modes return preview contracts without provider calls.
- Interface unit tests:
  - Plan creation includes active bundle context and fingerprint.
  - Apply selected proposals only.
  - Stale fingerprints and invalid patches reject without mutating the editor.
- Integration tests:
  - `/api/ai/edit/plan` and `/api/ai/edit/apply` cover card generation, repair routing, visual previews, and stale-plan rejection.
  - `/api/connector/plan` remains compatible.

### 7. Wrong vs Correct

#### Wrong

```js
// Directly mutate the server editor before checking the plan fingerprint.
store.editor.addCard(plan.proposals[0].patches[0].card);
```

#### Correct

```js
const result = applyAiEditPlan({ editor: store.editor, plan, proposalIds });
store.replaceEditor(result.editor);
```

The Pipeline owns patch validation, the Interface owns stale-plan protection, and the server replaces the active editor only after the full selected patch set succeeds.
