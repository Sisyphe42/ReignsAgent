# Error Log

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

### Resolution
- **Resolved**: 2026-07-10T22:15:00+08:00
- **Notes**: Completed clean-room packaging with a verified local Electron ZIP cache and left active workspace dependencies untouched.

---
