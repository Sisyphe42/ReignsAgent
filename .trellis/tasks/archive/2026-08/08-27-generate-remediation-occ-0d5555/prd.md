# Generate remediation for occ 0d5555

## Goal

Generate, but do not apply to the selected checkout or verify/close in the workbench, one canonical remediation patch for Codex Security occurrence `occ_0d5555efef50c63676eea3a2` at recorded base revision `0a457eb1c58024876002bc90f9251bce797cf794`.

## Background

The authoritative finding states that the local Creator API treats loopback binding as authorization: API dispatch lacks Host, Origin, and per-process capability checks; JSON mutations accept non-JSON content types; saved AI credentials can be combined with a request-selected endpoint; and Vite accepts arbitrary Host headers. The selected checkout has unrelated user changes, so remediation development must occur on the isolated `fix/creator-api-request-trust` worktree while the selected checkout remains untouched.

## Requirements

- R1: Refresh the authoritative finding before any remediation write and proceed only while request ID, action token, pending action, base revision, and current version match the supplied workbench identity.
- R2: Enforce the local HTTP trust boundary before API body parsing with an exact active backend Host check, a local-origin check, and an unguessable per-process capability for protected API routes.
- R3: Preserve a narrowly scoped bootstrap mechanism that lets the same-origin Creator clients obtain the capability without exposing it cross-origin.
- R4: Require `application/json` on JSON-bearing mutation routes while preserving binary image staging and bodyless requests.
- R5: Prevent saved text or image credentials from being attached when the request-selected endpoint does not match the corresponding persisted endpoint; explicit transient request credentials must continue to work.
- R6: Replace Vite's arbitrary Host allowance with an explicit local allowlist.
- R7: Update every repository-owned Creator HTTP client and direct test/smoke caller needed to preserve Node ZIP, Vite development, Electron, legacy dashboard/player, and integration workflows.
- R8: Add focused regression coverage for unexpected Host, foreign Origin, missing/wrong capability, text/plain JSON, saved-key endpoint mismatch, allowed legitimate requests, and Vite host configuration.
- R9: Produce a single unified diff with scan-target-relative paths at the exact requested artifact path, record its digest/base revision, and transition only to `generated` (or `failed`) using the refreshed expected version.

## Acceptance Criteria

- [x] AC1: The original browser-to-loopback request path cannot reach protected API operations without passing Host, Origin, content-type where applicable, and capability checks before body parsing.
- [x] AC2: A request-selected endpoint cannot receive a persisted API key unless it matches the relevant persisted trusted endpoint; an explicitly supplied key remains supported.
- [x] AC3: Normal same-origin Creator Web, legacy dashboard/player, direct integration, Node ZIP, Vite proxy, and Electron smoke workflows have a supported capability path.
- [x] AC4: Focused tests and the applicable package/repository checks run successfully in the isolated worktree during patch development.
- [x] AC5: The canonical patch contains only source, tests, and required documentation for this finding and is written outside the selected checkout under the scan artifact directory.
- [x] AC6: Workbench state is recorded as `generated` with request `289b95c8-690d-41bf-a1eb-408bf1935ef0`, action token `d84a1f3c-4335-4de7-a366-cc35535d585d`, refreshed expectedVersion, exact patch path, SHA-256 digest, and base revision.
- [x] AC7: No apply, workbench verify, close, merge, push, or PR operation is performed. A local commit on `fix/creator-api-request-trust` is authorized by the user after generation completed.

## Out of Scope

- Applying the patch to `D:\projects\ReignsAgent`.
- Executing the workbench apply or verify stages, closing the finding, pushing, or opening/merging a PR.
- Remediating the other three scan findings or broad transport refactors.
