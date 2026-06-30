# Contextual AI Assist actions design

## State and Routing

- Add a small `aiDraftRequest` state in `App` that carries mode, instruction, target card id, and optional asset id.
- Add `openAiAssistDraft(request)` in `App`: enable AI Assist, store the request, and open the `ai-edit` panel.
- `AiAssistPanel` consumes the pending request and applies it to its local controls when it changes.

## Panel Entry Points

- Content receives `aiAssistEnabled` and `onAiAction`. When a card is selected, show a compact action strip above the editor with rewrite, expand, and follow-up actions.
- Story receives `aiAssistEnabled` and `onAiAction`. Show a compact action strip near graph controls for bridge/branch/ending/gate actions, using the focused card when available.
- Review receives `aiAssistEnabled` and `onAiAction`. Show repair/explain actions near diagnostics; repair uses `repair_diagnostics` mode.

## Behavior

- Entry points are UI routing helpers only.
- The AI Assist panel remains the single place for draft generation, progress, proposal preview, and apply.
- If there is no selected card, actions should still open AI Assist with project-level instructions.

## Non-Goals

- No real provider execution.
- No inline floating text-selection menu.
- No direct graph mutation from AI.
