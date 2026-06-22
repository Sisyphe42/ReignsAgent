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
- **Documentation Duty**: When a new feature, module, or hook changes product behavior, architecture, or roadmap direction, update the relevant project documentation (`README.md`, `ROADMAP.md`, or package docs). Keep this file focused on durable agent rules and constraints.
- **Zero-Pollution Rule**: Do not mix Module A game logic with Module B AI generation logic.
- **Git & Review Rule**: The Agent must maintain a clean Git history. Never squash multiple phases into one commit. Ensure all unit tests pass *before* calling `git commit`. Include what was changed and what to review in the commit body.
- **Review Economy Rule**: Default to completing routine engineering workflow automatically. Ask the user for review only when a decision is high-impact, ambiguous, or difficult to undo.

## 3.1 Git Workflow
- **Solo-Maintainer Default**: This is currently a solo project. Prefer direct commits to `master` for routine work after checks pass; do not create PRs just to simulate team process.
- **Use PRs As Review Artifacts**: Open a PR when the change benefits from a durable review record: new modules, large features, cross-module work, public contracts/schema/API changes, security/privacy behavior, connector or deployment behavior, release work, governance changes, or nontrivial refactors. Group related commits into one reviewable PR by behavior or risk area.
- **Keep PR Count Low**: Avoid one-commit/one-PR workflows and avoid PRs for tiny docs, tests, typos, formatting, mechanical cleanup, or low-risk internal maintenance. These may go straight to `master` with clear commit messages.
- **Branch Naming When Needed**: Use conventional prefixes such as `feature/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`, `refactor/<slug>`, `release/<version-or-title>`, or short-lived `phase/<milestone-title>`. Do not use agent/tool prefixes.
- **Checks Before Commit/Merge**: Run `npm run verify` before commit or merge. For deployable player changes, also run `npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>`. For visible frontend changes, smoke test the dashboard/player locally.
- **Ask First Only For High-Impact Operations**: Ask before making a private repo public, force-pushing `master`, deleting protected branches or release tags, publishing external packages/builds, changing production deployment state, deleting remote releases/artifacts, rotating or deleting credentials, irreversible data changes, or ambiguous product decisions.
- **Cleanup**: After merged PRs, delete temporary branches locally and remotely, update `master`, and create/update milestone tags when a phase is complete.

## 4. Repository Map
- `packages/core`: Pure headless game runtime. No UI, IO, AI generation, or deployment logic.
- `packages/reviewer`: Headless Monte Carlo simulation, graph diagnostics, and balance reports.
- `packages/pipeline`: Local import/export, content bundle handling, generation request contracts, and reviewer feedback actions.
- `packages/interface`: Creator workflow orchestration plus the current web dashboard/player surfaces.
- `scripts`: Local tools including the dev server, content CLI, build-game assembler, and verification gates.
- `fixtures`: Sample and validation content used by tests and local demos.
- `test`: Cross-package integration tests.

## 5. Planning Source
Product roadmap, dashboard restructuring notes, and near-term architecture plans live in `ROADMAP.md`. Keep this file focused on durable project rules and agent constraints.
