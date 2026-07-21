# First Repository Release Design

## Release Shape

The repository release is one GitHub Release keyed by the canonical root version:

```text
master commit
  -> metadata/version gate
  -> Node Creator ZIP job
  -> four native Electron build + smoke jobs
  -> release assembly and archive verification
  -> SHA256SUMS.txt
  -> tag-gated GitHub Release
```

Primary assets:

| Asset | Producer | Runtime requirement |
| --- | --- | --- |
| `reigns-agent-0.1.0.zip` | Ubuntu/Node job | Node.js 22+ and a browser |
| `ReignsAgent-win32-x64-0.1.0.zip` | Windows job | Windows 10/11 x64; WebView2 for Project EXEs |
| `ReignsAgent-darwin-x64-0.1.0.zip` | Intel macOS job | macOS x64 |
| `ReignsAgent-darwin-arm64-0.1.0.zip` | Apple Silicon macOS job | macOS arm64 |
| `ReignsAgent-linux-x64-0.1.0.zip` | Ubuntu job | Linux x64 |
| `SHA256SUMS.txt` | Release assembly job | Any SHA-256 verifier |

GitHub-generated source archives remain supplemental and are not treated as tested Creator distributions.

## Default-Branch Reliability Gate

Release work starts by removing the remaining Hosted navigation flake seen on merge run `29801670644`. The failure is a real 5 px vertical displacement measured after the rail width transition; checking `scrollTop` for one zero sample does not prove that Chromium has completed scroll anchoring and layout.

The test must synchronize on the owning UI behavior, such as transition completion plus consecutive stable animation frames and stable geometry, while keeping the final `< 1 px` assertion unchanged. A retry of the whole test or a relaxed pixel tolerance is not an acceptable release gate.

## Version Contract

`package.json` is the canonical product version. A release metadata verifier reads the root and Electron manifests, derives expected archive names, and optionally accepts a tag input. It rejects:

- workspace/product version drift;
- a tag other than `v${rootVersion}`;
- archive filenames with a different version;
- missing or malformed semantic versions.

The first public release intentionally normalizes the unpublished Electron `0.1.2` value back to the repository-wide `0.1.0` line.

## Artifact Contract

Artifact verification owns a single manifest of expected release assets and archive invariants. ZIP inspection must validate contents, not only outer extensions:

- project MIT license and third-party notices;
- platform executable/runtime markers;
- Node launchers and Creator runtime;
- no `ReignsAgentData`, `.env`, tests, source-only Creator files, credentials, installer formats, or unexpected secondary archives;
- exactly one version-consistent archive per target.

The existing Node and desktop verifiers should share helpers where practical so legal, user-data, and secret exclusions cannot drift.

## Workflow Boundaries

`.github/workflows/desktop.yml` remains the native build workflow. It gains a universal Node-distribution job and a final release-assembly job.

- `workflow_dispatch`: build, smoke, verify, upload workflow artifacts; never publish.
- `push.tags: v*`: run the same build graph, then permit the final job to create the GitHub Release.
- All build jobs use `contents: read`.
- Only the final tag-gated job uses `contents: write`.
- The final job downloads named artifacts, rejects missing/duplicate/unexpected files, generates checksums, and publishes atomically after validation.

Release notes should come from a checked-in `CHANGELOG.md` section or a dedicated release-notes file rather than an unreviewed generated summary alone.

## Dependency Risk Boundary

Runtime and release-tool dependencies are reviewed separately:

- `npm audit --omit=dev` must remain clean because those dependencies can affect shipped local services/runtime behavior.
- Full-audit findings are evaluated against whether the vulnerable package executes during packaging. Compatible overrides/upgrades require the complete packaging smoke matrix.
- If Electron Forge has no compatible fixed chain, the release review records that the finding is dev-only, the trusted-input assumptions, the exact affected versions, and the upstream issue/advisory. Acceptance must be explicit rather than hidden by excluding dev dependencies.

## Rollout and Recovery

1. Validate the workflow with `workflow_dispatch` on the release branch.
2. Merge only after the full native matrix and normal PR CI are green.
3. Validate `master` again.
4. Create `v0.1.0` only with explicit approval.
5. If tag publication fails before a release exists, fix forward and re-run the same commit where safe. Do not move or recreate a public tag without explicit approval.
6. If a published asset is incorrect, stop announcement and create a documented replacement release; do not silently overwrite trusted assets.
