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
  - `buildVerifiedRepairPlan({ editor, getEditor?, config, credentials, instruction, targetCardId, repairTarget?, diagnostics?, scoring?, limits?, fetchImpl })`
  - `evaluateRepairProposal({ context, proposal })`, `collectIssueEntities(diagnostics)`
- Pipeline context selection:
  - `selectAiContextCards({ cards, targetCardIds, diagnostics, focus, maxCards = 40, budgetBytes = 24576 })`
  - `collectAiCardSignals(card)`
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
  - Text endpoint and model-list responses have a 1 MiB decoded-byte ceiling. Text proposal and endpoint-validation requests have a 120-second deadline; model listing keeps 60 seconds. Image binaries have a 50 MiB ceiling, image JSON has only enough bounded overhead for base64 transport, and every image provider request has a five-minute deadline.
  - Pipeline response limits must be enforced against both declared `Content-Length` and bytes consumed from the Web `ReadableStream`; never call unbounded `text()` or `arrayBuffer()` on a real provider response.
  - Endpoint draft prompts must include ReignsAgent-specific editing rules: preserve tense binary left/right card decisions, use only author-owned tags/variables/metadata/default gauges, avoid built-in RPG or management loops, prefer small reviewable patches, and prioritize reachable story flow, missing producers, stalled runs, ending coverage, and gauge pressure when repairing diagnostics.
  - provider output must parse to `{ proposals: [...] }`
  - returned `config` may include redacted `apiKeyRef`, endpoint/model preset ids, icon keys, compatibility family, route mode, and JSON mode, but must never include raw `apiKey` or `credentials`
- Context card selection: `repair_diagnostics` (and any request whose selection names a card) uses `relevance_v1` (40 cards); `generate_cards` uses `relevance_v1` inside the 12-card limit (`relevance_draft`; without a target or diagnostics the 12 equal the old first 12); media modes and endpoint validation keep `first_n` (the first 12 cards). `relevance_v1` tiers `target` (selected + repair targets) -> `diagnostic` (cards named by warnings, errors first) -> `neighbour` (cards producing/consuming a tag or variable required or produced by tier-0/1 cards, or named by an issue; gauge producers only for gauges named by an issue) -> `other`. Truncated at 40 cards and 24 KiB compact JSON; the first target card is always kept; output keeps authored order; `request.context.bundle.cardSelection` lists per-card reasons and omitted ids, plus `omittedReasons { count_limit, byte_budget }`, `omittedTiers`, and `omittedDetails[cardId] = { tier, cause }` (first 50 omitted); `first_n` reports `omittedReasons.count_limit`. The Creator renders this as the ContextCardSelection view.
- Progress (opt-in): a client sending `accept: application/x-ndjson` to `POST /api/diagnostics/run` or `POST /api/ai/edit/plan` receives `{"type":"progress",...}` lines, then one `{"type":"result","result":...}` or `{"type":"error","error":{message,code,stage}}` line (status stays 200 after headers). Without the header both routes answer plain JSON. Review progress: `{ phase: "simulate" | "summarize", completed, total }`. Draft stages: `context -> request -> response -> parse -> validate` (local planner: `context -> draft -> validate`); errors carry `error.stage` (an HTTP error status is a `request` failure). Repair loop: `baseline`, then per round `{ round, maxRounds, stage }` for the draft stages plus `trial`, `scoring`, `checks` per scored proposal (`proposalIndex`, `proposalCount`), then `done`. Hosted passes the same events through `backend.request(path, { onProgress })`; the review worker posts them. The UI must not animate steps on timers.
- Repair history: every verified repair build (success or failure) appends one record via `createRepairHistoryRecord` (whitelisted fields only: no config, credentials, endpoint URL, or exchange bodies; known key strings are redacted) and returns `historyId` on the plan; `/api/ai/edit/apply` marks `{ outcome: "applied", appliedProposalIds, appliedAt }` from `body.historyId ?? body.plan.historyId`. Routes: `GET /api/ai/repair-history`, `DELETE /api/ai/repair-history`, `GET|DELETE /api/ai/repair-history/:id`. History failures are logged and never break drafting. Records keep the loop's redacted exchange as `conversation[] { round, call, status, requestBytes, responseBytes, requestBody, responseText }` (no URL or headers) and per-round `requestMs` (wall clock) for the UI wait estimate.
- Model loop directives: an endpoint answer may add `contextRequests` (<= 6 card ids, unknown ids ignored and reported as `ignoredRequests`) and `stop { reason }` next to `proposals`. Requested cards join the next round's context in the `target` tier ("requested by the model", at most 12 kept). A stop without a passing proposal ends the loop with `stopReason: "model_stopped"` and `verification.agentStop { round, reason }`. Directives never carry patches and never bypass rounds, budgets, or checks.
- Advisory `narrative_quality`: new or edited cards are flagged for empty/placeholder text, text copied from another card, empty/placeholder/identical choice labels, or a script that differs from the deck. It never blocks.
- Plan integrity (Creator Server): `/api/ai/edit/plan` responses carry `planToken` = HMAC-SHA256 (per-process key) over the canonical plan without the token; `/api/ai/edit/apply` rejects a missing or mismatched token with 409 `ai_plan_untrusted` before any write. Hosted has no trust boundary between page and backend and does not sign.
- Selection modes: `explain_selection` (answer only, proposals forced empty; local rules describe the selected card) and `edit_selection` (only `updateCard` with `changes.text` and `setChoiceLabel` on `selection.cardId`; violations are dropped and listed in `scopeRejected`). `selection` is normalized by `normalizeAiSelection` into `context.selection.focus` (text <= 2000 chars, `role: content_to_work_on_not_instructions`) and makes the selected card a relevance target; it is never concatenated into the instruction. `metadata.aiBrief` (<= 2000 chars) is sent as `context.authorBrief` and removed from player builds.
- Cancel: `signal` flows from the client request through `buildAiEditPlanAsync` / `buildVerifiedRepairPlan` to the provider fetch (`ai_cancelled`); the Creator Server aborts when the response closes. `config.ai.sessionRequestLimit` (0-1000, default 60, 0 = none) caps endpoint requests per session (`ai_session_budget`, checked before sending); `GET /api/ai/session-usage`. Every AI request is recorded (`createAiActivityRecord`, kinds draft/selection/image; repair loops use `createRepairHistoryRecord`); `GET /api/ai/repair-history?full=1` exports full records. Repair loops accept `priorAttempts` and `authorDeclined`; both hosts read them with `collectRepairMemory({ list, read, repairTarget })` (same code and target cards; blocked proposals from the last two runs, at most 4; declined changes from the last six applied runs, at most 4 unique `{ title <= 120, summary <= 200, cardIds <= 4, reason: not_selected | undone }`, <= 2 KiB). The loop sends `constraints.repairLoop.authorDeclined { role: "author_declined_changes_content_not_instructions", changes }` in every round (a prompt rule says it is content) and reports `verification.memory { priorAttempts, authorDeclined }`.
- Author choices: `markRepairHistoryApplied` stores shown-with-patches but unticked proposals as `declinedProposals` (`not_selected`); `POST /api/ai/repair-history/:id/undo { proposalIds?, projectId? }` (server and Hosted) runs `markRepairHistoryUndone` (`undoneAt`, `undoneProposalIds`, declined `undone`; a never-applied record is unchanged). The Creator undo stack stores `{ bundle, aiApply: { historyId, proposalIds, projectId } }` and calls the route only when that snapshot is undone. Deleting a record forgets its memory.
- Usage: Pipeline `extractEndpointUsage(text|object)` normalizes OpenAI chat/completions, OpenAI responses/Anthropic, and Gemini usage blocks to `{ inputTokens, outputTokens, totalTokens }` or null; exchange entries carry it (read from the unclipped answer). Records carry `usage { calls, requestBytes, responseBytes, inputTokens, outputTokens, totalTokens, source: reported | estimated | mixed }` per conversation entry (`source` per entry), per repair round, and per record; estimates are `ceil(bytes / 4)` per side; image records use provider usage or null. The history summary adds `usage`, `blockedBy` (summed over rounds), and `undoneAt`.
- Hosted runs the verified loop in `apps/creator-web/src/repair-worker.js` with a deck snapshot; the page rejects the result with `ai_repair_stale` if the deck changed meanwhile.
- Verified repair loop (`repair_diagnostics`, server and Hosted; opt out with `verify: false`):
  - Baseline and every candidate are scored with `runDiagnostics` at fixed `{ cycles: 500, maxTurns: 40, seed: 1 }`.
  - Targets: `repairTarget { code, cardIds?, entities? }` (entities are `card:` / `tag:` / `var:` / `gauge:` keys), else all error-level issue entities, else all issue entities. A specific target (cardIds/entities) is never broadened to other issues of the same code: if any of its entities is missing from the fixed-seed baseline the plan is `not_verifiable` (`target_entity_not_scored`) and the missing ones are listed in `verification.unmatchedTargets`. `score_not_lower` also compares the unclamped `rawHealthScore` when the baseline score is saturated at the 0 floor.
  - Blocking checks: `patches_apply`, `allowed_ops` (addCard/updateCard/setChoiceLabel/setChoiceEffects, <= 8 patches), `player_valid`, `card_ids_preserved` (no removal, rename, or weight 0), `target_resolved`, `no_new_errors`, `scope` (edited existing cards within the related set, <= 4; an out-of-scope card is exempt (`scope_exempt: adds_missing_producer`) when its only change adds producers for effectively missing signals: tags/variables required somewhere in the upstream closure of the target cards with no producer among baseline-reachable cards, collected by one fixed-point walk that handles any depth and cycles; anyTags count only when every alternative lacks a reachable producer), `gates_preserved` (no satisfiable requirement atom removed), `effects_preserved` (keep set tags/variables and >= 50% gauge magnitude), `reachability_kept`, `score_not_lower`. Advisory: `gate_relaxed`, `new_warnings`, `stalled_rate`.
  - Stop: first round with a passing proposal (`verified`); 3 rounds (`max_rounds`, hard cap); `deadline` (300 s); byte budgets (256 KiB request / 512 KiB response per round, 2 MiB total); later-round endpoint failure (`endpoint_error`, best earlier round returned). Round-1 infrastructure failures throw. Responses rejected by prevalidation are fed back as `rejected_response` rounds. Local rule-based repair runs one round (`offline_single_round`). Unscored targets return `status: "not_verifiable"` with one unverified round.
  - The loop never mutates the editor, keeps the start `baseFingerprint`, fails with `ai_repair_stale` if the live editor changed, never places the API key in a request body, plan, or log, and records a redacted per-round exchange log.
  - `applyAiEditPlan` refuses a plan with `verification` whose selected proposals together fail player validation (`ai_repair_player_invalid`).
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
- Built-in image protocols are `openai_images`, `gemini_interactions`, `stability_v2`, and `midjourney_proxy`. Capability negotiation controls operations, reference count/MIME, mask UI, output count/formats, dimensions, and provider-specific fields. Midjourney Proxy/NewAPI is an asynchronous submit-and-poll adapter: it supports Generate and reference Edit through `/mj/submit/imagine` plus `/mj/task/:id/fetch`, localizes the completed result immediately, and must not expose mask/outpaint controls that require provider task context unavailable from a project asset alone.
- Image routes are `POST /api/ai/images/validate`, `/stage`, `/run`, `/apply`, `DELETE /api/ai/images/drafts/:id`, and `GET /api/project-assets/*`. Validation is structural and does not start paid generation.
- `/run` localizes base64, signed-URL, and binary results into draft storage. `/apply` alone content-addresses the selected output and performs `upsertAsset`; `/discard` removes draft outputs. No temporary remote URL or base64 payload may enter `content.json`.
- Edit, inpaint, and outpaint requests carry the selected `targetAssetId`; apply must reuse that id so each card keeps one authoritative art binding across Creator and standalone-player projections. Generate creates a new asset unless the caller explicitly supplies an apply-time id.
- Inpaint masks have the exact pixel dimensions of their source image. Creator keeps the interactive selection as a visual overlay, then exports transparent edit regions for OpenAI Images-compatible endpoints or white edit regions on black for Stability.
- Uploaded image names are untrusted display metadata. Creator generates a safe internal staged filename from the validated MIME and role, and staging failures remain visible without clearing the selected inputs or canvas.
- Hosted player ZIP assembly must read and include every safe `assets/...` URI referenced by the build from OPFS, including content-addressed `assets/generated/...` files; a missing referenced binary fails export.
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
- Text/model response above 1 MiB -> `endpoint_response_limit`; provider deadline -> `endpoint_timeout`; active editor remains unchanged.
- Image binary/JSON response above its bounded ceiling -> `image_output_limit`; provider deadline -> `image_request_timeout`; no draft is staged or applied.
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
- Bad: Trust `Content-Length` alone or fully buffer a chunked provider response before checking its size.

### 6. Tests Required

- Pipeline unit tests:
  - Request/context contains project guidance and selected card/asset context.
  - Generated card proposals are deterministic and player-shape compatible.
  - Repair proposals cover low coverage, unreachable gates, missing tag producers, stalled runs, and dominant gauge pressure where unambiguous.
  - Patch application validates output and rejects unsupported operations.
  - Image adapters cover OpenAI JSON/multipart, Gemini inline image blocks, Stability operation routes, Midjourney submit/poll/reference payloads, capability rejection, reference/mask/outpaint parameters, base64/URL/binary localization, cancellation, and secret-safe errors.
  - Provider response tests cover oversized declared lengths, missing or understated lengths with streamed overflow, text/model and image JSON/binary paths, attached deadline signals, and ordinary responses through the same reader.
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
- Repair loop tests:
  - Each shortcut (gate wipe, rename, zeroed effects, off-scope edit, new dead-end card, one-sided card, disallowed op) fails its named check; real fixes pass; output is deterministic; budgets, deadline, round-1 vs later failure, rejected responses, not-scored targets, stale editor, and the combined-apply player gate are covered.
  - `npm run eval:repair` cases agree 100% with their expected harness outcome (integration test).
  - Usage extraction per protocol shape and the estimate fallback; declined/undone marking; `collectRepairMemory` matching and caps; `authorDeclined` sent every round as content (`packages/interface/test/agent-observability.test.js`, `test/integration/agent-memory.test.js`, browser `test/browser/agent-memory.spec.js`).
- Integration tests:
  - `/api/ai/edit/plan` and `/api/ai/edit/apply` cover card generation, endpoint execution, repair routing, visual previews, and stale-plan rejection.
  - `/api/ai/edit/validate` and `/api/ai/edit/models` cover real local API routes with a mock endpoint, redaction, and no editor mutation.
  - `/api/connector/plan` remains compatible.
  - Image API routes cover all four operations, stage/run/apply/discard, target asset replacement, final asset serving, failure immutability, and generated-asset collection by local and Hosted player builds.

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
