# Error Log

## [ERR-20260715-007] hosted_opfs_ci_flake

**Logged**: 2026-07-15T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
The Hosted CI job intermittently failed while a test directly read an OPFS file, then passed unchanged on rerun.

### Error
```text
NotReadableError: The requested file could not be read, typically due to permission problems after a file reference was acquired.
```

### Context
- Node verification, deployable-player smoke, desktop smoke, and five other Hosted tests passed.
- The exact failing test passed locally after rebuilding Hosted output with `REIGNS_AGENT_BASE_PATH=/reignsagent/`.
- Running the local test against output built for a different base path caused Service Worker readiness to time out and was not a valid reproduction.
- The bundled CI inspection helper also required UTF-8 process decoding on this Windows locale, so `gh run view --log-failed` was used as the reliable fallback.

### Suggested Fix
Build and test with the same base-path environment, rerun the isolated failing test, and rerun only the failed GitHub job when the evidence indicates an OPFS race rather than a product regression.

### Metadata
- Reproducible: no
- Related Files: test/browser/hosted.spec.js, .github/workflows/ci.yml

### Resolution
- **Resolved**: 2026-07-15T00:00:00+08:00
- **Notes**: The isolated local test passed and the unchanged Hosted CI job passed 6/6 on rerun.

---

## [ERR-20260715-006] github-push-close-notify

**Logged**: 2026-07-15T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
GitHub closed the HTTPS connection while pushing Trellis wrap-up commits.

### Error
```text
fatal: unable to access 'https://github.com/Sisyphe42/ReignsAgent.git/': schannel: server closed abruptly (missing close_notify)
```

### Context
- The feature commits had already pushed and PR #25 existed.
- Only the task-archive and session-journal commits remained local.

### Suggested Fix
Keep the branch history unchanged and retry the normal push after confirming the local branch is only ahead, not diverged.

### Metadata
- Reproducible: no
- Related Files: .trellis/workspace/journal-1.md

### Resolution
- **Resolved**: 2026-07-15T00:00:00+08:00
- **Notes**: Confirmed the branch was ahead without divergence and retried the push.

---

## [ERR-20260715-005] powershell-shell-fallback

**Logged**: 2026-07-15T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary
A repository scan used a POSIX-style fallback after `rg` in PowerShell.

### Error
```text
The term 'exit' is not recognized as a name of a cmdlet, function, script file, or executable program.
```

### Context
- The command used `|| exit 0` to treat ripgrep's no-match code as success.
- Repository commands run under PowerShell and should inspect `$LASTEXITCODE` directly.

### Suggested Fix
Use a PowerShell conditional and distinguish `rg` no-match exit code 1 from execution errors above 1.

### Metadata
- Reproducible: yes
- Related Files: .learnings/ERRORS.md

### Resolution
- **Resolved**: 2026-07-15T00:00:00+08:00
- **Notes**: Repeated the scan using PowerShell-native exit-code handling.

---

## [ERR-20260715-004] build_panel_locale_hook

**Logged**: 2026-07-15T00:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
The new Build panel referenced a non-existent locale hook, causing the workbench to render blank.

### Error
```text
ReferenceError: useLocale is not defined
```

### Context
- Creator components consume `LocaleContext` through the repository helper `useUiLocale`.
- Vite compilation did not catch the runtime identifier error; browser smoke did.

### Suggested Fix
Reuse the established `useUiLocale` helper and run a real-browser smoke for visible panel changes.

### Metadata
- Reproducible: yes
- Related Files: apps/creator-web/src/main.jsx

### Resolution
- **Resolved**: 2026-07-15T00:00:00+08:00
- **Notes**: Switched the Build panel to `useUiLocale` and repeated the browser check.

---

## [ERR-20260715-003] interface_test_method_name

**Logged**: 2026-07-15T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
A deterministic build ID test called a metadata method that is not part of the card editor API.

### Error
```text
TypeError: editor.updateMetadata is not a function
```

### Context
- `createCardEditor` exposes `setMetadata`, while the server session state uses a differently named metadata operation.
- The test should exercise the public editor contract it instantiated.

### Suggested Fix
Check the returned editor surface before writing a mutation-based test and use `setMetadata`.

### Metadata
- Reproducible: yes
- Related Files: packages/interface/test/interface.test.js

### Resolution
- **Resolved**: 2026-07-15T00:00:00+08:00
- **Notes**: Replaced the invalid call with `setMetadata` and reran the focused suite.

---

## [ERR-20260710-001] electron-workspace-runtime-dependency

**Logged**: 2026-07-10T00:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary
The installed Electron app could not resolve a dependency hoisted outside its workspace package.

### Error
```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'electron-squirrel-startup' imported from app.asar/src/main.mjs
```

### Context
- The desktop app is an npm workspace under `apps/desktop-electron`.
- Development-mode Electron smoke tests used the repository-level `node_modules` and passed.
- The installed Squirrel app had no matching module inside `app.asar`.

### Suggested Fix
Keep the desktop main process dependency-free where practical and run smoke tests against the packaged executable after Forge makes the native artifacts.

### Metadata
- Reproducible: yes
- Related Files: apps/desktop-electron/src/main.mjs, .github/workflows/desktop.yml

### Resolution
- **Resolved**: 2026-07-10T22:15:00+08:00
- **Notes**: Removed the hoisted runtime dependency, unpacked the utility entry/runtime, used a physical working directory, and added packaged-executable smoke coverage.

---

## [ERR-20260715-002] release_test_fixture

**Logged**: 2026-07-15T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
The Windows release API smoke test selected a content fixture that is valid for import coverage but not player-ready.

### Error
```text
InterfaceError: Cannot build: player cards are invalid; left/right choices are required.
```

### Context
- `fixtures/content/minimal.cards.json` uses legacy choice names and intentionally fails the deployable player contract.
- Release tests must exercise the successful path with `oss-court.cards.json`; invalid fixtures belong in explicit rejection tests.

### Suggested Fix
Use a player-ready fixture for build/export success cases and assert invalid fixture rejection separately.

### Metadata
- Reproducible: yes
- Related Files: test/integration/creator-server.test.js
- See Also: ERR-20260715-001

### Resolution
- **Resolved**: 2026-07-15T00:00:00+08:00
- **Notes**: Switched the release smoke setup to the repository's player-ready fixture.

---

## [ERR-20260715-001] node_test_fixture

**Logged**: 2026-07-15T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
A duplicate-path test used a JavaScript Map, which discarded the duplicate key before the release validator received it.

### Error
```text
AssertionError [ERR_ASSERTION]: Missing expected exception.
```

### Context
- The Windows release payload test attempted to create two `player.html` entries with `new Map(...)`.
- Map key uniqueness made the fixture incapable of representing the invalid input under test.

### Suggested Fix
Use an entry-pair array when testing duplicate-key validation at a boundary.

### Metadata
- Reproducible: yes
- Related Files: packages/interface/test/windows-release.test.js

### Resolution
- **Resolved**: 2026-07-15T00:00:00+08:00
- **Notes**: The payload normalizer accepts entry-pair arrays specifically for ordered boundary input and duplicate validation.

---

## [ERR-20260713-001] playwright-status-selector

**Logged**: 2026-07-13T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
Hosted CORS smoke selectors must account for shared status classes and React form-node replacement during persisted setting updates.

### Resolution
Assert the endpoint-specific success modifier class and dispatch the three controlled input events in one browser task so React batches the update before replacing form nodes.

### Metadata
- Pattern-Key: hosted.playwright.stable-selectors
- Recurrence-Count: 3

---

## [ERR-20260710-005] powershell-command-path-passing

**Logged**: 2026-07-10T23:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
PowerShell treated paths appended after `-Command` as expression text instead of positional script arguments.

### Error
```text
Unexpected token '<portable package path>' in expression or statement.
```

### Context
- The portable archive script passed source and target paths after the `-Command` expression.
- Paths were not made available through `$args` as expected.

### Suggested Fix
Pass filesystem paths through child-process environment variables when invoking PowerShell expressions from Node.

### Metadata
- Reproducible: yes
- Related Files: scripts/build-portable-desktop.mjs

### Resolution
- **Resolved**: 2026-07-10T23:20:00+08:00
- **Notes**: ZIP source and target paths now use dedicated environment variables, avoiding quoting and whitespace ambiguity.

---

## [ERR-20260710-004] forge-zip-node25-incompatibility

**Logged**: 2026-07-10T23:15:00+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary
Electron Forge's ZIP maker failed on Node 25 because its latest `cross-zip` dependency uses a removed recursive `fs.rmdir` option.

### Error
```text
TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.recursive' is no longer supported. Received true
```

### Context
- The repository supports Node 20 and newer.
- `cross-zip` 4.0.1 is the latest published version and still uses the removed API.
- Electron packaging completed; only archive creation failed.

### Suggested Fix
Keep Forge responsible for the native Electron package and create portable archives with a repository-owned cross-platform script using native ZIP facilities.

### Metadata
- Reproducible: yes
- Related Files: scripts/build-portable-desktop.mjs, package.json, .github/workflows/desktop.yml

### Resolution
- **Resolved**: 2026-07-10T23:15:00+08:00
- **Notes**: Removed all Forge makers and added a Node 20-25 compatible portable ZIP assembly step.

---

## [ERR-20260710-003] brand-log-contract-drift

**Logged**: 2026-07-10T23:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
A product-name cleanup changed a server startup log but missed an integration test that parsed a shorter legacy substring.

### Error
```text
Timed out waiting for release server output. Received: ReignsAgent: http://127.0.0.1:<port>/workbench
```

### Context
- The server was healthy and listening.
- The initial repository search targeted the full old product name and did not match the test's shorter `Creator:` regular expression.

### Suggested Fix
When changing user-visible log names, search both the complete old name and distinctive substrings consumed by tests or scripts.

### Metadata
- Reproducible: yes
- Related Files: apps/creator-server/src/server.mjs, test/integration/release-build.test.js

### Resolution
- **Resolved**: 2026-07-10T23:00:00+08:00
- **Notes**: Updated the release integration test to parse the canonical `ReignsAgent:` startup line.

---

## [ERR-20260710-002] local-node-modules-incomplete

**Logged**: 2026-07-10T00:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary
Forge make could not run from the active workspace because a transitive file was missing from the existing root `node_modules`.

### Error
```text
Cannot find module node_modules/@electron/get/node_modules/fs-extra/lib/index.js
```

### Context
- The failure occurred before Electron packaging started.
- Long-running local development processes may be holding the root dependency tree.
- Source and desktop tests that do not traverse this dependency still pass.

### Suggested Fix
Validate packaging from a clean temporary workspace with `npm ci`; avoid deleting or rewriting a dependency tree used by active processes.

### Metadata
- Reproducible: yes
- Related Files: package-lock.json
- Recurrence-Count: 2
- Last-Seen: 2026-07-11

### Resolution
- **Resolved**: 2026-07-10T22:15:00+08:00
- **Notes**: Completed clean-room packaging previously. On recurrence, a lockfile-driven `npm ci` restored the incomplete nested package and allowed Forge to reach native packaging.

---

## [ERR-20260711-001] electron-zip-download-tls

**Logged**: 2026-07-11T13:05:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary
Electron Forge packaging was interrupted while downloading the Electron ZIP by a transient TLS disconnect.

### Error
```text
Client network socket disconnected before secure TLS connection was established
```

### Context
- Source, integration, release, and Electron utility-process tests were already green.
- The required Electron 43.1.0 Windows x64 ZIP already existed in Electron's content-addressed local cache.

### Suggested Fix
Use the repository-supported `ELECTRON_ZIP_DIR` override when a verified matching ZIP is cached; otherwise retry the external download without changing product code.

### Metadata
- Reproducible: no
- Related Files: apps/desktop-electron/forge.config.mjs, README.md

### Resolution
- **Resolved**: 2026-07-11T13:07:00+08:00
- **Notes**: Reused the cached Electron 43.1.0 ZIP, then completed portable packaging, double-launch persistence smoke, and artifact verification.

---

## [ERR-20260711-001] package-manifest-patch

**Logged**: 2026-07-11T16:39:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
A structural patch left package.json with a trailing comma and missing closing brace.

### Resolution
Validated the manifest with JSON.parse before regenerating the lockfile.

---

## [ERR-20260711-002] playwright-local-install

**Logged**: 2026-07-11T16:42:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
A lockfile-only install did not place the newly added Playwright test dependency in node_modules.

### Resolution
Installed workspace dependencies before running the Hosted Chromium smoke.

---

## [ERR-20260714-001] playwright-theme-style-timing

**Logged**: 2026-07-14T01:13:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
A hosted UI assertion read theme-dependent computed styles before React updated the root `data-skin` attribute.

### Error
```text
Expected Latte project and skin-select backgrounds to match, but the project trigger still reported the previous Github Light color.
```

### Context
- The test selected `catppuccin-latte` and immediately read both computed styles.
- The native select surface updated before the root theme selector finished rendering.

### Suggested Fix
Wait for `html[data-skin="catppuccin-latte"]`, then poll until both theme-dependent computed styles agree.

### Metadata
- Reproducible: yes
- Related Files: test/browser/hosted.spec.js

### Resolution
- **Resolved**: 2026-07-14T01:16:00+08:00
- **Notes**: Added a root-theme wait plus computed-style polling; the hosted suite passed 6/6.

---

## [ERR-20260713-001] playwright-stale-reference

**Logged**: 2026-07-13T22:24:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
A Playwright CLI click reused an element reference after switching the Creator skin.

### Error
```text
Error: Ref e97 not found in the current page snapshot. Try capturing new snapshot.
```

### Context
- The skin selection substantially changed the page state.
- The next click incorrectly reused a reference from the previous snapshot.

### Suggested Fix
Capture a fresh snapshot after theme changes before using element references.

### Metadata
- Reproducible: yes
- Related Files: apps/creator-web/src/styles.css

### Resolution
- **Resolved**: 2026-07-13T22:26:00+08:00
- **Notes**: Opened a fresh browser session, captured a new Phantom snapshot, and completed the compact-state visual check without console errors.

---

## [ERR-20260714-002] github-actions-api-eof

**Logged**: 2026-07-14T02:01:42+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
GitHub CLI intermittently returned an unexpected EOF while reading an Actions job.

### Error
```text
failed to get job: Get "https://api.github.com/repos/Sisyphe42/ReignsAgent/actions/jobs/86890271965": unexpected EOF
```

### Context
- `gh run view 29271532082 --job 86890271965 --log-failed` failed during CI diagnosis.
- GitHub's public job page exposed only the failing step, not the detailed test output.

### Suggested Fix
Retry through the REST job logs endpoint: `gh api repos/<owner>/<repo>/actions/jobs/<job-id>/logs`.

### Metadata
- Reproducible: no
- Related Files: .github/workflows/ci.yml

### Resolution
- **Resolved**: 2026-07-14T02:01:42+08:00
- **Notes**: The REST logs endpoint returned the complete job log and exact Playwright assertion.

---
