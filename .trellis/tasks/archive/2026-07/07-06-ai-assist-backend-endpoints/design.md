# AI Assist backend endpoint execution design

## Architecture

AI Assist endpoint execution stays in Pipeline and Interface boundaries:

- Pipeline owns request construction, endpoint call formatting, response extraction, proposal validation, and patch prevalidation.
- Interface owns editor fingerprinting, redacted connector config normalization, and stale-plan protection.
- The local dev server bridges transient browser credentials into the Interface async planning call.
- Core, Reviewer, build-game, and deployable player files remain untouched by provider execution.

## Data Flow

1. Creator builds an AI Assist plan request with existing mode, instruction, target card, asset, diagnostics, and connector config.
2. If an endpoint is configured and provider is not `stub`, the browser sends `credentials.apiKey` alongside the request body.
3. The local API calls the async Interface planning function.
4. Interface converts editor state to a bundle and calls Pipeline provider planning.
5. Pipeline builds the same AI context/request preview used by local planning, formats a protocol-specific HTTP request, and calls the endpoint with `fetch`.
6. Pipeline extracts JSON from the provider response, accepts only `{ proposals: [...] }`, validates the proposals through `applyAiEditPatches` against a cloned bundle, and returns a normal plan schema.
7. Applying proposals remains unchanged: `applyAiEditPlan` checks `baseFingerprint`, applies selected patches atomically, validates the resulting editor, and only then replaces server state.

Settings validation uses the same boundary stack without creating a plan: Creator posts redacted config plus transient credentials to `/api/ai/edit/validate`, Interface snapshots the current editor bundle, Pipeline sends a validation request through the selected protocol/route/model, parses `{ proposals: [] }`, prevalidates any returned proposals if present, and returns a redacted validation summary. It never mutates the editor.

Settings model listing is a separate read-only metadata probe: Creator posts redacted config plus transient credentials to `/api/ai/edit/models`, Interface normalizes the connector config, Pipeline resolves the current base URL to an OpenAI-compatible `/models` endpoint, sends a GET with the same auth header convention, parses OpenAI `{ data: [...] }` plus simple `models` array shapes, and returns normalized `{ id, label }` records. It never mutates the editor and never returns raw credentials.

## Contracts

- `createAiEditSuggestions(...)` remains synchronous and deterministic.
- Add an async provider-backed Pipeline function for AI Edit planning.
- Add an async Pipeline endpoint validation function that reuses protocol request construction, auth headers, URL resolution, JSON extraction, JSON-mode fallback, and redaction.
- Add an async Pipeline model-listing function that reuses endpoint normalization, auth header construction, model response parsing, and redaction.
- Add an async Interface function for AI Edit planning that chooses provider execution when `config.endpoint` and `config.modelId` are present and `provider !== "stub"`.
- Add an async Interface endpoint validation function used by local API `POST /api/ai/edit/validate`.
- Add an async Interface model-listing function used by local API `POST /api/ai/edit/models`.
- `credentials.apiKey` is accepted only as request input. Returned `config` may include `apiKeyRef`, never `apiKey`.
- Protocol request shapes:
  - Responses: `{ model, input, text: { format: { type: "json_object" } } }`
  - Messages/OpenAI Chat: `{ model, messages: [{ role: "system", content }, { role: "user", content }], response_format: { type: "json_object" } }`
  - Completions: `{ model, prompt, temperature: 0 }`
- Response extraction supports direct JSON, fenced JSON strings, Responses output text, Chat choices message content, and legacy choices text.

## Error Handling

- A configured endpoint failure is an error, not a silent stub fallback.
- HTTP non-2xx, network failure, malformed provider response, missing `proposals`, unsupported patches, and invalid patch targets raise Pipeline errors.
- The dev server wraps these errors as JSON with `error.name`, `error.message`, and a stable `error.code` where possible.

## Compatibility

- Existing `/api/ai/edit/plan` and `/api/ai/edit/apply` body shapes continue to work.
- Existing deterministic tests and local preview behavior continue to work.
- `messages` means OpenAI-compatible Chat Completions, not Anthropic Messages.
- Canonical protocol values are `openai_chat`, `openai_responses`, and `openai_completions`; legacy `messages`, `responses`, and `completions` normalize to those values.
- Route resolution supports `auto`, `api_root`, and `full_url`. `auto` treats known protocol-route suffixes as full endpoint URLs and appends the selected route otherwise.
- JSON mode is controlled by `jsonMode` and `capabilities.structuredJson`; OpenAI JSON mode failures retry once without the structured JSON parameter on the same protocol.
- Creator endpoint/model preset data is serializable and frontend-owned. The visible setup follows NewAPI channel configuration patterns: a compact provider channel type selector, official/brand logos for recognition, editable model defaults, editable base URL, and Advanced compatibility controls. SenseNova is treated as an OpenAI-compatible preset (`https://token.sensenova.cn/v1`, `sensenova-6.7-flash-lite`). Interface and Pipeline preserve/redact preset metadata but do not own provider profile management.
