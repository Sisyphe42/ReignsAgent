# ReignsAgent System Specification & Agent Guidelines

## 0. Project Goal
ReignsAgent is a production-oriented, Reigns-like agentic game product for generating, testing, editing, previewing, and shipping card-based narrative experiences.

This is not only a developer middleware project. The final system must be usable by real content creators through a functional frontend where they can import content, configure or connect AI generation, edit generated cards, preview gameplay, inspect balance diagnostics, and prepare deployable game builds. Architecture must remain separated, but the product goal includes a complete user-facing creation and publishing workflow.

The long-term goal is a self-improving loop:
- **Core** runs the game rules headlessly and stays small, deterministic, and UI-free.
- **Reviewer** stress-tests card sets through Monte Carlo simulation and emits objective JSON diagnostics.
- **Pipeline** imports local content, calls generation connectors, and uses Reviewer diagnostics to propose or generate corrections.
- **Interface** provides the production frontend for content development, AI configuration, editing, preview, diagnostics, and deployment preparation while preserving module boundaries.

The project should optimize for pure left/right card interaction, simple rules, inspectable data, automated balance feedback, and modular evolution. The player-facing game must remain the cleanest possible Reigns-style swipe experience.

Anti-RPG rule: the system may reserve low-level variable/tag interfaces for user-defined customization, but it must not predefine or build any upper-level item, equipment, pet, status, shop, rarity, crafting, character-build, inventory-management, or progression system. Any such concepts may exist only as user-authored data labels interpreted by custom content, not as built-in gameplay, UI, or product features. The visible gameplay remains pure card text plus binary left/right choices.

## 1. Core Architecture (Decoupled Design)
- **Module A: ReignsAgent-Core**: Headless runtime. Handles 4 factions (0-100), loops, game-over, and card scheduler. No UI/IO.
- **Module B: ReignsAgent-Pipeline**: Handles local JSON/CSV import/export and LLM API connectors for automated content & asset generation.
- **Module C: ReignsAgent-Reviewer**: Independent Monte Carlo simulation engine. Runs 100k cycles headlessly, generates JSON diagnostic reports, and feeds back to Module B for self-correction.

## 2. Extensibility Specification
- **Variable Store**: Must support a dynamic low-level variable/tag store for user-authored content state.
- **Custom Data Labels**: Content authors may use arbitrary labels in their own data, but the engine must not ship predefined equipment, pet, status, shop, rarity, crafting, class, skill-tree, or inventory-management concepts.
- **Lifecycle Hooks**: Variable/tag hooks may implement `on_acquire`, `on_tick`, and `on_dismiss` to modify card pool weights and faction scales dynamically. These hooks are engine-level extension points only, not a mandate to build item systems or UI.

## 3. Maintenance Protocols
- **Agent Duty**: Every time a new feature, module, or hook is implemented, the Agent MUST update this file under the `## 4. Implementation Progress` section.
- **Zero-Pollution Rule**: Do not mix Module A game logic with Module B AI generation logic.
- **Git & Review Rule**: The Agent must maintain a clean Git history. Never squash multiple phases into one commit. Ensure all unit tests pass *before* calling `git commit`. Include what was changed and what to review in the commit body.
- **Review Economy Rule**: Default to completing routine engineering workflow automatically. Ask the user for review only when a decision is high-impact, ambiguous, or difficult to undo.

## 3.1 Git Workflow
- **Default Automation**: The Agent may run tests, create branches, commit, push, open/merge PRs, delete temporary branches, and repair reversible git mistakes without asking first.
- **When PRs Are Required**: Use a PR for user-facing features, cross-module changes, public contracts, security/privacy behavior, connector or deployment behavior, nontrivial refactors, release work, and governance changes. Group related commits into one reviewable PR by behavior or risk area; do not create one PR per commit by default.
- **When Direct Commits Are Acceptable**: Small docs edits, tests, typo fixes, formatting, mechanical cleanup, and low-risk internal maintenance may go directly to `master` after the relevant checks pass.
- **Branch Naming**: For PR work, use `feature/<pr-title-slug>`, `docs/<pr-title-slug>`, `fix/<pr-title-slug>`, `release/<version-or-title>`, or short-lived `phase/<milestone-title>`. Do not use agent/tool prefixes.
- **Checks Before Commit/Merge**: Run `npm run verify` before commit or merge. For deployable player changes, also run `npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>`. For visible frontend changes, smoke test the dashboard/player locally.
- **Ask First Only For High-Impact Operations**: Ask before making a private repo public, force-pushing `master`, deleting protected branches or release tags, publishing external packages/builds, changing production deployment state, deleting remote releases/artifacts, rotating or deleting credentials, irreversible data changes, or ambiguous product decisions.
- **Cleanup**: After merged PRs, delete temporary branches locally and remotely, update `master`, and create/update milestone tags when a phase is complete.

## 4. Implementation Progress
- [x] Phase 1: Core Headless Runtime & Variable Hook Architecture (Implemented in `packages/core`; low-level variable/tag hooks, snapshot/restore, deterministic step API, JSON-safe event log, no RPG systems)
- [x] Phase 2: Monte Carlo Simulation Bot & Graph Analyzer (Implemented in `packages/reviewer`; headless JSON diagnostics, default 100k cycles, single-cycle simulator, event samples, coverage metrics, configurable thresholds, no pipeline connectors)
- [x] Phase 3: AI Pipeline Generator & Diagnostic Feedback Loop (Implemented in `packages/pipeline`; local JSON/CSV/content-bundle exchange, stable connector request contracts, reviewer feedback action plans, local conversion/feedback commands)
- [x] Phase 1-3 Contract Hardening: Card contract validation, variable-aware graph diagnostics, fixture content verification, and local content validation/review CLI (Implemented)
- [x] Build/Test Gate: Syntax checks, package export smoke tests, module boundary checks, Anti-RPG drift checks, fixture verification, unit tests, integration tests, lockfile, and GitHub Actions CI (Implemented)
- [x] Phase 4: Unified Playable Interface & Local Ingestion Dash (Implemented in `packages/interface` and `scripts/dev-server.mjs`; local creator dashboard/player preview APIs, player-card validation, diagnostics projection, connector request preview, deployable player build assembly, and Phase 4 gates)
- [x] Phase 4 Sample Content Pack: Complete local test deck with Game-icons.net CC BY 3.0 SVG art assets, dashboard sample loading, player art previews, and deployable asset copying (Implemented)
- [x] Phase 4 Presentation/i18n Extension Interfaces: Policy-gated presentation config for CSS variables/raw CSS/HTML/JS slots plus locale catalog, localized card/session/player runtime resolution, and sample `en`/`zh-Hans` content (Implemented)
