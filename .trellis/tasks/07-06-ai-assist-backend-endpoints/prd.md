# AI Assist backend endpoint execution

## Goal

Complete AI Assist backend endpoint execution so creator-supplied text endpoints can produce explicit edit proposals through the existing safe plan/apply workflow.

## Background

- The Creator UI already captures lightweight endpoint settings: base URL, API key, protocol, model id, and capability flags.
- The local backend currently returns deterministic local AI Assist proposals through `POST /api/ai/edit/plan` and applies selected proposals through `POST /api/ai/edit/apply`.
- AI Assist must remain creator-only. Core, Reviewer, deployable player builds, and apply paths must not perform provider calls or contain provider SDKs.

## Requirements

- Keep the deterministic local planner available when no endpoint is configured or `provider: "stub"` is used.
- Add real text endpoint execution for configured AI Assist plan requests:
  - `responses` uses OpenAI-compatible `/responses`.
  - `messages` uses OpenAI-compatible `/chat/completions`.
  - `completions` uses legacy `/completions`.
  - If the configured endpoint already ends with the protocol route, use it as-is; otherwise append the route.
- Provider output must be accepted only as JSON containing `{ "proposals": [...] }`.
- Provider proposals must be validated as patch proposals against the current bundle before returning a plan, without mutating the editor.
- `POST /api/ai/edit/plan` must accept transient `credentials.apiKey`; the backend must use it only for the active request and must not store, log, echo, or include it in returned plans.
- Endpoint, provider, model id, capability flags, and redacted API key reference must remain available in plan config for preview/debug context.
- Endpoint/network/parse/validation failures must return structured JSON errors instead of silent local fallback when a real endpoint was configured.
- Visual modes remain JSON request/proposal previews only; no binary upload, download, generation, or inspection is in scope.
- Update Creator request handling minimally so configured API keys are sent only with plan requests and UI text no longer says real network calls are disabled.
- Add lightweight Creator endpoint/model presets as frontend-owned convenience data:
  - Primary settings expose editable endpoint preset/base URL, editable model preset/model id, API key, and capabilities.
  - Advanced settings expose protocol, route mode, compatibility family, and JSON mode preference.
  - Generic/unified base URI presets default to OpenAI-compatible Chat Completions.
  - Manual base URL edits reset preset/icon to Custom unless the value exactly matches a preset again.
  - Manual model id edits reset the model preset id unless the value exactly matches a model preset again.
- Backend protocol normalization accepts canonical `openai_chat`, `openai_responses`, and `openai_completions` values plus legacy `messages`, `responses`, and `completions` aliases.
- Provider requests retry once without OpenAI structured JSON parameters when the endpoint rejects JSON mode, without switching protocol.

## Acceptance Criteria

- [ ] Configured `responses`, `messages`, and `completions` endpoints can return AI Assist plans with provider proposals.
- [ ] Local stub planning still works when no endpoint is configured or `provider: "stub"` is used.
- [ ] Raw API keys do not appear in plan responses, proposal responses, logs, editor bundles, build manifests, or tests snapshots.
- [ ] Invalid provider output, unsupported patch ops, missing patch targets, and endpoint failures return JSON errors and do not mutate the editor.
- [ ] Selected provider proposals still apply through `POST /api/ai/edit/apply` with existing stale-fingerprint protection.
- [ ] `npm run verify` passes before completion.

## Out of Scope

- Streaming responses, tool/function calling, reasoning controls, provider presets, model discovery, MCP, skills, multi-profile management, and deployable-player AI behavior.
