# Design

## Patch boundaries

The current branch is the integration branch. The already committed trust-boundary patch is treated as an existing control and is verified, not rewritten. The remaining changes stay at four shared boundaries: Creator body ingestion, Reviewer option normalization, Workspace TOML parsing, and Pipeline response materialization.

## Request and diagnostics limits

Creator JSON routes share a fixed JSON byte ceiling enforced first against a valid Content-Length and again while consuming chunks. The existing binary image-stage route keeps its separate 50 MiB reader. Oversize errors carry an explicit code and HTTP 413 and occur before route dispatch mutates state.

Creator diagnostics normalize finite positive integers and enforce the Hosted-compatible 10,000-cycle / 200-turn ceiling before invoking Interface/Reviewer. Reviewer independently enforces a 100,000-cycle / 200-turn ceiling so CLI and direct library calls remain bounded while preserving the stated 100k headless review goal.

## TOML parser invariant

TOML construction must create and traverse only own data properties. Every section segment and assignment key is checked against the prototype-sensitive key set before lookup or write. Valid documents continue to return ordinary plain objects, avoiding a public shape change to null-prototype maps.

## Provider response limits

An internal Pipeline response reader performs Content-Length preflight, then incrementally reads Web `ReadableStream` bodies with cancellation on overflow. It falls back for test doubles that expose only `arrayBuffer()` or `text()`, with a post-read bound because those mocks cannot stream.

- AI edit and model-list text responses use a bounded text ceiling suitable for proposal/metadata JSON.
- Image-provider JSON uses a larger ceiling that can represent one base64-encoded 50 MiB output plus JSON overhead.
- Direct and URL-fetched image binaries use the existing 50 MiB project-asset ceiling.

All limits fail closed with stable Pipeline/ImagePipeline error codes. Abort behavior and valid response parsing remain unchanged.

## Compatibility and rollback

- Existing same-origin Creator clients, standard JSON mutations, the binary stage route, documented review examples, valid TOML, and normal AI/image provider responses remain supported.
- The Pipeline helper contains no Node-only imports so Hosted browser execution remains viable.
- Each boundary receives focused tests before the full repository gate. If a compatibility failure appears, roll back only that boundary's patch and reassess its limit or enforcement location.
- User-owned `package.json` and `package-lock.json` changes are never staged or rewritten.
