# Implementation Plan

1. Record the current branch/diff and verify the existing Creator API trust-boundary tests from commit `5cd3798`.
2. Add a bounded shared request-body reader in Creator Server, route JSON and binary ingestion through it, and add declared-length, streamed-overflow, empty/valid, and binary compatibility tests.
3. Add explicit Creator diagnostics normalization at 10,000 cycles / 200 turns and Reviewer public limits at 100,000 cycles / 200 turns; test upper bounds, overflow rejection, and ordinary/default deterministic behavior.
4. Harden Workspace TOML parsing with dangerous-key rejection and own-property traversal; add direct `__proto__`, `constructor.prototype`, assignment-key, and valid nested-document tests.
5. Add a browser-compatible bounded Pipeline response reader and use it for model lists, edit proposals, every image JSON response, direct binary image response, and remote image materialization.
6. Add focused response tests for Content-Length preflight, chunked overflow, fallback mocks, ordinary text/JSON, valid image bytes, and stable limit error codes.
7. Challenge the patch in a separate inline review pass: enumerate every caller of changed helpers, trace both branches of every new condition, test one alternate malicious representation per finding, and check one ordinary input newly rejected by each limit.
8. Run syntax/import gates, focused package and integration tests, then `npm run verify`. Update README/security-facing documentation if externally visible behavior is not already documented.
9. Inspect the final diff against `master` and the working tree, confirm `package.json` and `package-lock.json` remain user-only changes, then commit only the remediation/task files with a review-oriented message. Do not push or create/merge a PR.

## Focused validation commands

- `node --test test/integration/creator-api-security.test.js test/integration/creator-server.test.js`
- `node --test packages/reviewer/test/reviewer.test.js`
- `node --test packages/workspace/test/contracts.test.js packages/workspace/test/workspace.test.js`
- `node --test packages/pipeline/test/pipeline.test.js`
- `npm run verify`

## Risk and rollback points

- Large legitimate project imports: keep the JSON ceiling explicit and test a normal import through the same reader.
- Review compatibility: preserve 100,000 cycles at the Reviewer boundary and Hosted's existing 10,000/200 contract at the Creator boundary.
- Browser compatibility: keep the response reader Web-API-only and verify Pipeline tests plus Hosted-capable bundling through the repository gate.
- False confidence from headers: enforce actual streamed byte totals even when Content-Length is absent or understated.
- Partial output retention: cancel overflowing response readers and never return partially decoded JSON or image bytes.
