# Implementation Plan

1. Refresh the authoritative scan context and confirm the occurrence action token, request ID, pending `generate` action, base revision, and expected version.
2. Trace server entry points, all Creator HTTP clients, start callers, credential fallback, persisted config projections, and existing integration/build tests.
3. Add the centralized request-trust gate and capability bootstrap to the Creator Server before API body parsing.
4. Update Creator Web, legacy dashboard/player, asset access, Vite host configuration, and direct Electron/test/smoke callers to use the capability without persistent storage.
5. Bind stored credential fallback to matching persisted endpoints while preserving explicit request credentials.
6. Add focused request-trust, content-type, credential-binding, legitimate-control, and Vite configuration regression tests.
7. Challenge the candidate for alternate Host/Origin/capability forms, asset-path bypass, direct caller regressions, and endpoint normalization bypasses; revise confirmed issues only.
8. Run syntax/build gate, focused security and legitimate controls, nearest integration tests, then `npm run verify` in the isolated worktree.
9. Create a source-and-test-only canonical unified diff relative to the recorded base revision, write it to the exact scan artifact path, and compute SHA-256.
10. Refresh the finding; if the action token still matches, use the refreshed version to record `generated`. On any unrecoverable generation failure, refresh and record `failed` instead. Do not run another stage.

## Risk and rollback points

- Rejecting legitimate clients: enumerate and update every direct `createCreatorServer` caller and browser HTTP adapter before verification.
- Capability leakage: keep it process-memory-only and exclude it from logs, persistence, build content, and error bodies.
- Endpoint comparison ambiguity: normalize URL syntax without broadening trust across hosts, paths, schemes, or ports.
- Patch contamination: generate the diff with an explicit allowlist of remediation source/test/doc paths so Trellis metadata and unrelated files cannot enter the artifact.
