# AI Assist frontend UX shell design

## State

- Add creator-web local state for AI Assist visibility and endpoint settings.
- Persist endpoint settings in `localStorage` for the creator dashboard only.
- Treat a text endpoint as configured when base URL and model id are present; API key may be empty for local gateways.

## UI Changes

- Header gets an `AI Assist` toggle button near skin/player controls.
- Settings replaces provider-only connector planning with an endpoint form: base URL, masked API key, protocol select, model id, and capability checkboxes.
- Overview adds an AI starter panel with a compact brief field and action buttons that route into the AI Assist panel or existing panels.
- AI Assist panel keeps current plan/apply mechanics but removes "offline" wording, shows endpoint status, and renders progress stages while building a draft.

## Behavior

- Existing backend calls remain unchanged.
- Build-plan requests include the endpoint descriptor when available, but the API continues to return deterministic local draft proposals.
- The UI must make clear that unconfigured endpoints still allow local draft planning, but real provider calls are not active yet.

## Non-Goals

- No real network LLM/image calls.
- No multi-profile provider manager.
- No MCP/skills/tool-agent integration.
- No direct Content/Story inline rewrite implementation in this task.
