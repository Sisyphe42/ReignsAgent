# Changelog

All notable changes to ReignsAgent are documented here. The project follows
semantic versioning for repository releases.

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

[0.1.0]: https://github.com/Sisyphe42/ReignsAgent/releases/tag/v0.1.0
