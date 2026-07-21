# First Repository Release Implementation Plan

## Phase 0 — Restore green `master` CI

1. Reproduce the floating-rail 5 px vertical displacement from merge run `29801670644` with repeated Hosted tests.
2. Trace the rail width transition, overflow behavior, and Chromium scroll anchoring to identify the actual settled-state signal.
3. Update UI/test synchronization while preserving the strict `< 1 px` icon-stability assertion.
4. Run the focused test repeatedly, the complete Hosted suite, and `npm run verify`.
5. Confirm the repair through PR CI and a post-merge `master` run before creating a release tag.

## Phase 1 — Normalize metadata and legal files

1. Synchronize root, Electron, lockfile, build-time About metadata, and archive naming on `0.1.0`.
2. Add a release-metadata verifier with unit/integration coverage for version and tag mismatch.
3. Stage the ReignsAgent MIT license and third-party notices in Node and Electron distributions.
4. Extend Node and Electron artifact tests to assert legal files and reject portable user data or forbidden files.

Validation:

```sh
npm run verify
npm run build:release
node scripts/verify-release-artifacts.mjs --root dist
```

## Phase 2 — Triage release-tool dependencies

1. Record the direct dependency paths behind the full-audit critical/high findings.
2. Test compatible Electron Forge, rebuild, tar, and temporary-file dependency upgrades or overrides.
3. Run source and packaged Electron smoke tests after any dependency graph change.
4. If a finding cannot be fixed compatibly, document the upstream constraint and trusted release-input boundary for explicit review.

Validation:

```sh
npm audit --omit=dev
npm audit
npm run test:desktop
npm run test:desktop:packaged -- <platform> <arch> <artifact-root>
```

## Phase 3 — Build and verify the complete asset set

1. Add the cross-platform Node Creator ZIP to the Desktop Artifacts workflow.
2. Make every platform upload only its final versioned ZIP plus machine-readable metadata if needed.
3. Add an assembly verifier for the exact five-ZIP asset set.
4. Generate deterministic `SHA256SUMS.txt` entries sorted by filename and verify them before publication.
5. Run `workflow_dispatch` from the release branch and inspect all four native jobs and downloaded artifacts.

Validation:

```sh
npm run build:release
npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>
npm run test:player:windows
npm run test:desktop:packaged -- <platform> <arch> <artifact-root>
```

## Phase 4 — Add tag-gated GitHub Release publication

1. Add a final workflow job dependent on every build/smoke job.
2. Download and flatten the named artifacts into a clean release directory.
3. Re-run metadata, archive-content, asset-set, and checksum verification.
4. Publish only when `github.ref` is a matching `refs/tags/v*`; keep manual runs non-publishing.
5. Use minimal job-level `contents: write` permission and fail if the release/tag already has incompatible assets.
6. Add workflow contract tests or static checks for permissions, dependencies, and tag gating.

## Phase 5 — Repository-facing release material

1. Add `CHANGELOG.md` with the `0.1.0` capability summary and known limitations.
2. Add `SECURITY.md` with the reporting and supported-version policy.
3. Update English and Chinese release instructions, asset descriptions, checksum verification, and WebView2/unsigned warnings.
4. Configure repository description, homepage, topics, secret scanning/push protection, and dependency security updates. Treat these GitHub mutations as separately reviewed external changes.

## Phase 6 — Review, merge, and release gate

1. Run `npm run verify` and all relevant release/package smoke tests.
2. Open one review PR for the release pipeline and metadata changes.
3. Require green PR CI plus a successful non-publishing Desktop Artifacts run.
4. Merge, update `master`, and require the post-merge CI run to pass.
5. Present the final commit, asset list, checksums, audit disposition, and release notes for user approval.
6. Only after explicit approval: create `v0.1.0`, monitor the tag workflow, inspect the GitHub Release, and smoke-test downloaded assets.

## Risk and Rollback Points

- Dependency overrides are isolated commits and are reverted if any platform packaging smoke fails.
- Workflow publication is tested through `workflow_dispatch`, which must never create a release.
- No tag is created during implementation or PR review.
- Public tags and release assets are immutable operational outputs; correcting them requires explicit user direction.
