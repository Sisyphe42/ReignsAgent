# Contextual AI Assist actions implementation

## Steps

- Add `aiDraftRequest` state and `openAiAssistDraft()` in `App`.
- Pass AI action props to Content, Story, and Review.
- Update `AiAssistPanel` to apply pending requests to mode, instruction, target card, and asset controls.
- Add a reusable `AiActionStrip` component for compact contextual actions.
- Add Content selected-card actions.
- Add Story structure actions.
- Add Review diagnostics actions.
- Add CSS for action strips and active/disabled states.

## Validation

- Run `npm run verify`.
- Smoke test with Playwright: enable AI Assist, trigger Content action, confirm AI Assist prefilled target/prompt; trigger Review repair action after Review; confirm mode/prompt.

## PR Handling

- Keep PR #18 open and update its body after pushing this task.
