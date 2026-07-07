# AI Assist Contracts

## Scenario: AI Assist Local and Endpoint Draft Flow

### 1. Scope / Trigger

- Trigger: AI Assist spans Pipeline request/proposal contracts, Interface editor orchestration, local API routes, and Creator UI state.
- Scope: local proposal generation, optional creator-configured text endpoint execution, review repair proposals, visual request previews, patch preview, contextual creator entry points, and atomic apply.
- Boundary: no provider SDKs, no secret storage, no binary image persistence, no provider calls in Core/Reviewer/apply/player builds, and no Core or Reviewer mutation.

### 2. Signatures

- Pipeline:
  - `buildAiContext({ bundle, instruction, targetCardIds, diagnostics, constraints, assets, mode })`
  - `buildCardEditRequest({ bundle, instruction, targetCardIds, diagnostics, constraints })`
  - `buildMediaEditRequest({ bundle, mode, instruction, targetCardId, assetId, style, diagnostics, constraints })`
  - `createAiEditSuggestions({ bundle, mode, config, instruction, targetCardId, assetId, diagnostics })`
  - `createAiEditSuggestionsFromEndpoint({ bundle, mode, config, credentials, instruction, targetCardId, assetId, diagnostics, fetchImpl })`
  - `validateAiEditEndpoint({ bundle, config, credentials, fetchImpl })`
  - `applyAiEditPatches({ bundle, patches })`
- Interface:
  - `buildAiEditPlan({ editor, config, mode, instruction, targetCardId, assetId, diagnostics })`
  - `buildAiEditPlanAsync({ editor, config, credentials, mode, instruction, targetCardId, assetId, diagnostics, fetchImpl })`
  - `validateAiEditEndpointConfig({ editor, config, credentials, fetchImpl })`
  - `applyAiEditPlan({ editor, plan, proposalIds })`
- Creator UI:
  - `openAiAssistDraft({ mode, instruction, targetCardId?, assetId?, cardCount?, theme?, autoBuild? })`
  - `openAiAssistPreflight({ source, actionId, actionLabel, mode, instruction, contextSummary, targetCardId?, assetId?, cardCount?, theme? })`
  - `AiAssistPreflight({ request, onChange, onBuild, onOpenPanel, onClose })`
  - `AiAssistPanel({ draftRequest })`
- Local API:
  - `POST /api/ai/edit/validate` with optional transient `credentials.apiKey`
  - `POST /api/ai/edit/plan` with optional transient `credentials.apiKey`
  - `POST /api/ai/edit/apply`

### 3. Contracts

- Plan response:
  - `schemaVersion: 1`
  - `baseFingerprint`: stable fingerprint of the active content bundle
  - `mode`: one of `generate_cards`, `repair_diagnostics`, `generate_asset`, `analyze_asset`
  - `config`: JSON-safe connector descriptor or preview settings
  - `request`: context-rich request preview with `purpose`, `responseFormat`, `schema`, and `context`
  - `provider`: optional redacted endpoint execution summary with protocol, endpoint URL, and model
  - `feedback`: optional reviewer feedback action summary
  - `proposals`: array of proposal records
- Endpoint execution:
  - `openai_chat` calls OpenAI-compatible `/chat/completions`; legacy `messages` is accepted as an alias.
  - `openai_responses` calls OpenAI-compatible `/responses`; legacy `responses` is accepted as an alias.
  - `openai_completions` calls legacy `/completions`; legacy `completions` is accepted as an alias.
  - Generic and unified base URI presets default to `openai_chat`; provider execution must not silently switch between Chat and Responses.
  - Route mode defaults to `auto`: if the endpoint already ends in a known protocol route, use it as the full URL; otherwise append the selected route. `api_root` always appends and `full_url` never appends.
  - JSON mode is capability-driven by default. If an endpoint rejects OpenAI JSON mode / `response_format`, retry once without that structured JSON parameter while keeping the same protocol.
  - Creator settings present endpoint presets as a NewAPI-style channel type selector inside a compact row form. Preset data stays frontend-owned, can use official/brand logos for recognition, and must still emit only normalized endpoint/protocol/model/capability config to Interface/Pipeline.
  - Endpoint validation is a real provider call through the same protocol, route resolution, auth header, response extraction, and JSON-mode fallback path as planning. It requests `{ proposals: [] }`, may prevalidate returned proposals if present, never mutates the editor, and never returns raw credentials.
  - provider output must parse to `{ proposals: [...] }`
  - returned `config` may include redacted `apiKeyRef`, endpoint/model preset ids, icon keys, compatibility family, route mode, and JSON mode, but must never include raw `apiKey` or `credentials`
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
- Contextual actions in Overview, Content, Story, and Review are routing helpers only. They may enable AI Assist, open preflight, open the AI Assist panel, and prefill mode/instruction/target fields, but must not call providers or mutate cards directly.
- Preflight request fields:
  - `source`: creator surface label such as `Overview`, `Content`, `Story`, or `Review`
  - `actionId`: stable UI action id for active/loading affordances
  - `actionLabel`: user-facing operation label
  - `contextSummary`: concise editable context explanation
  - `autoBuild`: optional flag for the AI Assist panel to build the draft after applying prefilled fields

### 4. Validation & Error Matrix

- Unknown mode -> `PipelineError` or API JSON error.
- Unsupported patch operation -> `PipelineError`; active editor must remain unchanged.
- Patch references a missing card or choice -> `PipelineError`; active editor must remain unchanged.
- `repair_diagnostics` without latest Review result in local API -> JSON error with `code: "diagnostics_required"`.
- Review contextual repair action without latest diagnostics -> disabled UI action; if bypassed, local API still returns `diagnostics_required`.
- `plan.baseFingerprint` differs from active editor fingerprint -> `InterfaceError`; active editor must remain unchanged.
- Patch result fails content bundle validation -> error before the server replaces `store.editor`.
- Configured endpoint HTTP/network failure -> API JSON error with endpoint error code; no local fallback.
- Configured endpoint malformed JSON, missing `proposals`, unsupported patch, or missing patch target -> `PipelineError`; active editor must remain unchanged.

### 5. Good/Base/Bad Cases

- Good: Creator runs Review, builds `repair_diagnostics`, previews patches, selects one proposal, and apply replaces the editor through the normal mutation path.
- Base: Creator builds `generate_cards`; deterministic stub cards have unique ids and exactly left/right choices.
- Base: Creator configures a text endpoint; provider proposals are validated and previewed before explicit apply.
- Base: Creator builds `generate_asset` or `analyze_asset`; UI shows request context and proposal preview without provider execution.
- Base: Creator triggers an Overview, Content, Story, or Review contextual action; the preflight surface opens with action, context, mode, output count, and editable prompt.
- Base: Creator builds from preflight; the AI Assist panel opens, runs staged progress, previews proposals, and still requires explicit proposal apply.
- Bad: Creator applies an old plan after editing content; apply is rejected as stale and no content is replaced.
- Bad: Proposal contains an unsupported patch operation; validation rejects the proposal and no partial edit is stored.
- Bad: Endpoint returns malformed JSON or a proposal targeting a missing card; plan creation fails and no content is replaced.

### 6. Tests Required

- Pipeline unit tests:
  - Request/context contains project guidance and selected card/asset context.
  - Generated card proposals are deterministic and player-shape compatible.
  - Repair proposals cover low coverage, unreachable gates, missing tag producers, stalled runs, and dominant gauge pressure where unambiguous.
  - Patch application validates output and rejects unsupported operations.
  - Visual request modes return preview contracts without provider calls.
  - Endpoint planning covers legacy and canonical OpenAI protocol values, route resolution, JSON-mode fallback, malformed output, patch prevalidation, and secret redaction.
- Interface unit tests:
  - Plan creation includes active bundle context and fingerprint.
  - Async plan creation routes to endpoints when configured and stays local for stub/no endpoint.
  - Apply selected proposals only.
  - Stale fingerprints and invalid patches reject without mutating the editor.
- Integration tests:
  - `/api/ai/edit/plan` and `/api/ai/edit/apply` cover card generation, endpoint execution, repair routing, visual previews, and stale-plan rejection.
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
