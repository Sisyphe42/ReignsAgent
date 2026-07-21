# AI Assist Contracts

## Scenario: AI Assist Local and Endpoint Draft Flow

### 1. Scope / Trigger

- Trigger: AI Assist spans Pipeline request/proposal contracts, Interface editor orchestration, local API routes, and Creator UI state.
- Scope: local proposal generation, optional creator-configured text endpoint execution, review repair proposals, real image generation/edit/inpaint/outpaint drafts, patch/image preview, contextual creator entry points, and atomic apply.
- Boundary: image execution and binary persistence are Pipeline/Creator/Workspace concerns only. Provider calls, credentials, draft tooling, and AI dependencies never enter Core, Reviewer, or deployable player code.

### 2. Signatures

- Pipeline:
  - `buildAiContext({ bundle, instruction, targetCardIds, diagnostics, constraints, assets, mode })`
  - `buildCardEditRequest({ bundle, instruction, targetCardIds, diagnostics, constraints })`
  - `buildMediaEditRequest({ bundle, mode, instruction, targetCardId, assetId, style, diagnostics, constraints })`
  - `createAiEditSuggestions({ bundle, mode, config, instruction, targetCardId, assetId, diagnostics })`
  - `createAiEditSuggestionsFromEndpoint({ bundle, mode, config, credentials, instruction, targetCardId, assetId, diagnostics, fetchImpl })`
  - `listAiEndpointModels({ config, credentials, fetchImpl })`
  - `validateAiEditEndpoint({ bundle, config, credentials, fetchImpl })`
  - `applyAiEditPatches({ bundle, patches })`
- Interface:
  - `buildAiEditPlan({ editor, config, mode, instruction, targetCardId, assetId, diagnostics })`
  - `buildAiEditPlanAsync({ editor, config, credentials, mode, instruction, targetCardId, assetId, diagnostics, fetchImpl })`
  - `listAiEditEndpointModels({ config, credentials, fetchImpl })`
  - `validateAiEditEndpointConfig({ editor, config, credentials, fetchImpl })`
  - `applyAiEditPlan({ editor, plan, proposalIds })`
- Creator UI:
  - `openAiAssistDraft({ mode, instruction, targetCardId?, assetId?, cardCount?, theme?, autoBuild? })`
  - `openAiAssistPreflight({ source, actionId, actionLabel, mode, instruction, contextSummary, targetCardId?, assetId?, cardCount?, theme? })`
  - `AiAssistPreflight({ request, onChange, onBuild, onOpenPanel, onClose })`
  - `AiAssistPanel({ draftRequest })`
- Local API:
  - `POST /api/ai/edit/validate` with optional transient `credentials.apiKey`
  - `POST /api/ai/edit/models` with optional transient `credentials.apiKey`
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
  - Endpoint model listing is a creator settings metadata probe only: local API posts transient credentials to Pipeline, Pipeline performs a GET against the resolved OpenAI-compatible `/models` endpoint, returns `{ models: [{ id, label }] }`, and never mutates the editor or returns raw credentials.
  - Endpoint draft prompts must include ReignsAgent-specific editing rules: preserve tense binary left/right card decisions, use only author-owned tags/variables/metadata/default gauges, avoid built-in RPG or management loops, prefer small reviewable patches, and prioritize reachable story flow, missing producers, stalled runs, ending coverage, and gauge pressure when repairing diagnostics.
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
- Image operations use `ImageEndpointConfig`, `ImageEndpointCapabilities`, `ImageOperationRequest`, `ImageDraftResult`, and `ImageAssetOutput`. `generate_asset` remains a compatibility alias for `generate`; `analyze_asset` retains the text-side visual analysis flow.
- Built-in image protocols are `openai_images`, `gemini_interactions`, and `stability_v2`. Capability negotiation controls operations, reference count/MIME, mask UI, output count/formats, dimensions, and provider-specific fields.
- Image routes are `POST /api/ai/images/validate`, `/stage`, `/run`, `/apply`, `DELETE /api/ai/images/drafts/:id`, and `GET /api/project-assets/*`. Validation is structural and does not start paid generation.
- `/run` localizes base64, signed-URL, and binary results into draft storage. `/apply` alone content-addresses the selected output and performs `upsertAsset`; `/discard` removes draft outputs. No temporary remote URL or base64 payload may enter `content.json`.
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
- Configured endpoint model-listing HTTP/network failure or malformed model payload -> API JSON error with endpoint error code; active editor must remain unchanged.
- Unsupported image operation/parameter/input MIME/count -> stable `image_*` error before provider execution; active editor and asset bindings remain unchanged.
- Image endpoint failure or cancellation -> preserve creator inputs and canvas state, do not commit or bind an asset, and never include credentials or raw sensitive provider responses in logs or responses.
- Image draft fingerprint differs from active editor -> `image_draft_stale`; the committed file and editor binding remain unchanged.

### 5. Good/Base/Bad Cases

- Good: Creator runs Review, builds `repair_diagnostics`, previews patches, selects one proposal, and apply replaces the editor through the normal mutation path.
- Base: Creator builds `generate_cards`; deterministic stub cards have unique ids and exactly left/right choices.
- Base: Creator configures a text endpoint; provider proposals are validated and previewed before explicit apply.
- Base: Creator builds `generate_asset`; it maps to real `generate`, shows one or more localized candidates, and changes no content until explicit Apply. `analyze_asset` continues to show its existing analysis proposal.
- Good: Creator edits, masks, or expands an existing card image; only controls supported by the selected adapter are shown, the selected candidate is committed by hash, and undo can restore the prior binding.
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
  - Image adapters cover OpenAI JSON/multipart, Gemini inline image blocks, Stability operation routes, capability rejection, reference/mask/outpaint parameters, base64/URL/binary localization, and secret-safe errors.
  - Endpoint planning covers legacy and canonical OpenAI protocol values, route resolution, JSON-mode fallback, malformed output, patch prevalidation, and secret redaction.
  - Endpoint planning asserts provider request prompts include the ReignsAgent professional editing rules, not only generic JSON formatting instructions.
  - Endpoint validation and model listing cover redacted credentials, `/models` route derivation from API roots or full protocol routes, malformed metadata rejection, and no editor mutation.
- Interface unit tests:
  - Plan creation includes active bundle context and fingerprint.
  - Async plan creation routes to endpoints when configured and stays local for stub/no endpoint.
  - Endpoint validation and model listing pass through normalized config plus transient credentials without returning secrets.
  - Apply selected proposals only.
  - Stale fingerprints and invalid patches reject without mutating the editor.
  - Image draft creation carries the active bundle fingerprint and explicit image apply performs only a validated `upsertAsset`.
- Integration tests:
  - `/api/ai/edit/plan` and `/api/ai/edit/apply` cover card generation, endpoint execution, repair routing, visual previews, and stale-plan rejection.
  - `/api/ai/edit/validate` and `/api/ai/edit/models` cover real local API routes with a mock endpoint, redaction, and no editor mutation.
  - `/api/connector/plan` remains compatible.
  - Image API routes cover all four operations, stage/run/apply/discard, final asset serving, failure immutability, and generated-asset collection by player builds.

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
