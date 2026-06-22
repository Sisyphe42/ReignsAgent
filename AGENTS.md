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
- **AGENTS.md Review Rule**: Progress tracking updates under `## 4. Implementation Progress` may be made as part of feature work. Other edits to this file are allowed when they improve project direction, architecture, or agent behavior, but they require manual review before being committed.

## 3.1 Branch, Build, Commit, PR, and Merge Workflow
- **Stable Line**: `master` is the stable integration branch. It must stay buildable and should only receive reviewed PR merges or explicitly approved direct maintenance commits.
- **Branch Naming Rule**: Branches use a small folder-style prefix plus the intended PR title as a lowercase kebab-case slug: `feature/<pr-title-slug>`, `docs/<pr-title-slug>`, `fix/<pr-title-slug>`, `release/<version-or-title>`, or short-lived `phase/<milestone-title>`. Examples: `feature/dashboard-choice-effects-editor`, `feature/live-dev-server-watch-mode`, `docs/branch-pr-workflow`, and `release/v0.1-stabilization`. Do not use agent/tool prefixes as project branch names.
- **Phase Tracking Rule**: Phases are product milestones, not daily development branches. Track phases with GitHub milestones, labels, PR titles, and optional tags such as `phase-4-complete`. Use a `phase-...` branch only as a short-lived integration branch when multiple feature PRs must be staged together.
- **Planned Branch Rule**: Pre-created planning branches are allowed only for near-term work that is already on the roadmap. Before starting work on an older planning branch, rebase or recreate it from the latest stable `master`.
- **Work Start Flow**: Update local refs, verify the working tree is clean, then create or switch to the categorized PR-slug branch. Keep each branch scoped to one reviewable PR.
- **Build/Test Gate**: Before committing, run `npm run verify`. For deployable player changes, also run `npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>`. For frontend-visible changes, run the local dev server and smoke test the dashboard/player in a browser.
- **Commit Rule**: Commit only after the relevant gate is green. Commit messages must include what changed, what was tested, and what reviewers should inspect. Do not bundle unrelated phases or unrelated feature areas into one commit.
- **PR Rule**: Push the branch and open a PR with a concise summary, test evidence, risk notes, and the manual review checklist. Draft PRs are allowed for early feedback; ready PRs require a green local gate first.
- **Merge Rule**: Merge only after CI is green and the required manual review boundaries below are satisfied. Prefer a normal merge or squash according to repository policy, but never erase meaningful phase history without explicit approval.
- **Cleanup Rule**: After merge, delete the temporary feature branch locally and remotely, update local `master`, and create or update milestone tags when a phase is complete.

## 3.2 Manual Review Boundaries
- **Must Be Reviewed By User Before Merge**: Changes to product direction, game design scope, Anti-RPG constraints, module boundaries, public data contracts, security/privacy behavior, connector/API credential handling, deploy/publishing behavior, and any non-progress edit to this AGENTS.md file.
- **Should Be Reviewed By User Before Merge**: User-facing frontend workflow changes, visual/interaction changes, generated sample content, localization tone, documentation that changes creator expectations, and large refactors even when tests are green.
- **Agent May Self-Prepare Without Waiting**: Running build/test gates, creating feature branches, making focused implementation commits, pushing branches, opening PRs, updating PR descriptions, attaching test evidence, and deleting temporary branches after an approved merge.
- **Agent May Self-Merge Only When Explicitly Authorized**: Low-risk mechanical fixes, test-only changes, CI/config maintenance, or documentation typo fixes may be self-merged only when the user has explicitly granted that permission for the PR or maintenance window.
- **Never Self-Merge**: AGENTS.md governance changes, architecture changes, player-facing gameplay changes, branch strategy changes, connector/security changes, or anything that failed a gate and was fixed without subsequent verification.

## 4. Implementation Progress
- [x] Phase 1: Core Headless Runtime & Variable Hook Architecture (Implemented in `packages/core`; low-level variable/tag hooks, snapshot/restore, deterministic step API, JSON-safe event log, no RPG systems)
- [x] Phase 2: Monte Carlo Simulation Bot & Graph Analyzer (Implemented in `packages/reviewer`; headless JSON diagnostics, default 100k cycles, single-cycle simulator, event samples, coverage metrics, configurable thresholds, no pipeline connectors)
- [x] Phase 3: AI Pipeline Generator & Diagnostic Feedback Loop (Implemented in `packages/pipeline`; local JSON/CSV exchange, connector interfaces, reviewer feedback actions)
- [x] Phase 1-3 Contract Hardening: Card contract validation, variable-aware graph diagnostics, fixture content verification, and local content validation/review CLI (Implemented)
- [x] Build/Test Gate: Syntax checks, package export smoke tests, module boundary checks, Anti-RPG drift checks, fixture verification, unit tests, integration tests, lockfile, and GitHub Actions CI (Implemented)
- [ ] Phase 4: Unified Playable Interface & Local Ingestion Dash (Pending)
