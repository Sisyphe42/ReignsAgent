# Changelog

All notable changes to ReignsAgent are documented here. The project follows
semantic versioning for repository releases.

## [0.1.1] - 2026-11-18

### Added

- Fog Harbor (雾港): a second bundled sample deck — 20 Chinese-language cards
  with original SVG illustrations, four authored gauges (商会 / 渔民 / 灯油 /
  议会), story groups, and tag labels, selectable from the Project menu.

### Fixed

- The shared `/play` player showed court-specific copy ("The court is
  waiting.") for every project before the first card. The pre-start prompt now
  comes from the active deck (description or title) with a neutral fallback.
- Player settlement summaries rendered raw gauge keys (`gauge1`–`gauge4`).
  Both the shared player and the deployable standalone player now show
  authored gauge labels for each row, the failed-gauge callout, and the
  game-over status line.
- The standalone player's game-over card text and "open a build" status were
  English-only; both now localize through the zh-Hans copy catalog.
- Card art in the Creator Content panel could disappear permanently after a
  Creator Server restart (rotated capability token), after undo/restore or
  project switches (premature object-URL revocation), or from a transient
  image failure. Requests now refresh and retry on stale sessions, artwork
  retries once before falling back, object URLs are no longer revoked while
  still referenced, and card art self-heals after recovery.
- The Hosted service worker cached non-success responses permanently for
  non-navigation requests; only `response.ok` bodies are stored now, so a
  cached 401/500 can no longer poison the runtime cache.

### Security and distribution notes

- No changes to the 0.1.0 posture: archives and generated Project EXEs remain
  unsigned, and API credentials stay Creator-side.

## [0.1.0] - 2026-07-21

### Added

- A React Creator workbench for project setup, card editing, story structure,
  simulation review, AI-assisted proposals, preview, and release preparation.
- A deterministic headless Core, content Pipeline, Monte Carlo Reviewer,
  host-neutral Workspace, and shared Creator Server.
- Cross-platform local Creator distributions: a Node.js ZIP, portable Electron
  ZIPs for Windows x64, macOS x64/arm64, and Linux x64, plus an offline-capable
  Hosted PWA build.
- A standalone player builder and a Windows x64 single-file Project player host
  using the installed Evergreen WebView2 Runtime.
- Player skins, directional card motion, keyboard/pointer/touch controls,
  build-scoped play records, authored language switching, and project credits.
- Version, archive-content, legal-file, exact-asset-set, and SHA-256 release
  verification gates.

### Security and distribution notes

- Creator desktop archives and generated Project EXEs are unsigned. Windows
  SmartScreen or macOS Gatekeeper may warn before first launch.
- Generated Windows Project EXEs require Microsoft Edge WebView2 Evergreen
  Runtime and do not download it automatically.
- The Node Creator ZIP requires Node.js 22 or newer and a local browser.
- API credentials remain Creator-side configuration and are excluded from
  player builds and default project/workspace exports.

[0.1.1]: https://github.com/Sisyphe42/ReignsAgent/releases/tag/v0.1.1
[0.1.0]: https://github.com/Sisyphe42/ReignsAgent/releases/tag/v0.1.0
