# AI Assist backend endpoint execution implementation

## Checklist

1. Read task artifacts and AI Assist contract specs before editing.
2. Add Pipeline helpers for endpoint URL resolution, protocol request bodies, auth headers, provider response text extraction, proposal JSON parsing, proposal shape validation, and patch prevalidation.
3. Add async provider-backed AI Edit planning while preserving existing local `createAiEditSuggestions`.
4. Extend Interface config normalization to preserve `modelId` and `capabilities`; add async planning that routes to provider execution only when endpoint/model are configured and provider is not `stub`.
5. Update local API `/api/ai/edit/plan` to pass transient credentials and return structured JSON errors.
6. Update Creator AI Assist request code to send `credentials.apiKey` only on plan requests and adjust endpoint status copy.
7. Add unit tests for Pipeline and Interface provider execution, redaction, malformed provider output, and local fallback.
8. Add integration tests with a local mock endpoint for `responses`, `messages`, `completions`, endpoint failure, malformed JSON, and no key echo.
9. Run `npm run verify`.

## Validation Commands

- `npm run test:unit`
- `npm run test:integration`
- `npm run verify`

## Risk Points

- Do not return `credentials.apiKey` from any API response.
- Do not let provider proposals mutate state before explicit apply.
- Do not silently fall back to local proposals when an endpoint is configured.
- Keep provider execution out of Core, Reviewer, and deployable player build code.
