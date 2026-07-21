# Implementation Plan

1. [x] Create a feature branch and activate this Trellis task.
2. [x] Add the versioned player payload assembler/parser helpers and unit tests for deterministic layout, validation, hashes, and unsafe paths.
3. [x] Add workspace release record/path operations with atomic persistence, active-project isolation, listing, download resolution, and deletion tests.
4. [x] Add Creator Server release routes, capability projection, artifact streaming, and integration coverage using a deterministic test host.
5. [x] Add the native Windows x64 WebView2 host, static loader build configuration, secure extraction/navigation, runtime detection, and smoke mode.
6. [x] Stage the native host into Windows local Creator/Node/Electron distribution workflows and add Windows CI build/smoke coverage.
7. [x] Upgrade the Build panel with release summary, validation gate, local target capability, progress, history download/delete, localization, and Hosted ZIP preservation.
8. [x] Update README, ROADMAP, workspace spec, and durable packaging boundary documentation.
9. [x] Run focused tests, `npm run build:game -- fixtures/content/oss-court.cards.json <temporary-dir>`, Windows native/generated-EXE smoke tests, and final `npm run verify`.
10. [x] Run Trellis quality/spec gates, commit in reviewable phases, push the feature branch, and open a PR.

## Rollback Points

- Keep old build APIs untouched so the new release routes/UI can be reverted independently.
- Native host staging is capability-gated; absent artifacts must disable EXE release without breaking Creator startup.
- Release records are additive JSON files and require no migration of existing project/config files.
