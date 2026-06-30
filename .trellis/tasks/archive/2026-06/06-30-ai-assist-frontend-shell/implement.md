# AI Assist frontend UX shell implementation

## Steps

- Add AI settings constants, default settings, localStorage read/write helpers, and configured-state helper in `apps/creator-web/src/main.jsx`.
- Add App state for `aiAssistEnabled` and `aiSettings`; pass it into Overview, AI Assist, and Settings.
- Rename the rail label and panel copy from AI Edit to AI Assist.
- Add the Header toggle with state labels and styling.
- Expand Overview with an AI starter panel and brief field that routes to the AI Assist panel.
- Replace Settings connector inputs with endpoint fields, protocol select, capability toggles, and a non-network "test" status.
- Update the AI Assist panel to consume settings, show endpoint status, remove provider input, and render progress steps during plan generation.
- Add CSS for the toggle, endpoint form, capability chips, starter panel, and progress timeline.

## Validation

- Run `npm run verify`.
- Run dashboard smoke if time permits: Settings endpoint form, AI Assist toggle, Overview starter, AI Assist plan generation, apply proposals.

## PR Handling

- Keep PR #18 as the single branch PR.
- Update PR #18 title/body after implementation so it no longer reads as docs-only.
