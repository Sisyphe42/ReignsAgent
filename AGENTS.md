# ReignsAgent System Specification & Agent Guidelines

## 0. Project Goal
ReignsAgent is a production-oriented, Reigns-like agentic game product for generating, testing, editing, previewing, and shipping card-based narrative experiences.

This is not only a developer middleware project. The final system must be usable by real content creators through a functional frontend where they can import content, configure or connect AI generation, edit generated cards, structure narrative progression, preview gameplay, inspect narrative and balance diagnostics, and prepare deployable game builds. Architecture must remain separated, but the product goal includes a complete user-facing creation and publishing workflow.

The long-term goal is a self-improving loop:
- **Core** runs the game rules headlessly and stays small, deterministic, and UI-free.
- **Reviewer** stress-tests card sets through Monte Carlo simulation and emits objective JSON diagnostics for coverage, pacing, endings, dead paths, and balance.
- **Pipeline** imports local content, calls generation connectors, and uses Reviewer diagnostics to propose or generate corrections.
- **Interface** provides the production frontend for content development, AI configuration, editing, preview, diagnostics, and deployment preparation while preserving module boundaries.

The project should optimize for pure left/right card interaction, inspectable data, automated narrative/balance feedback, and modular evolution. The player-facing game must remain the cleanest possible Reigns-style swipe experience, but the authored content may still contain data-driven chapters, themes, story arcs, endings, and stateful narrative evolution.

Narrative progression and Anti-RPG boundary: the system may support data-driven story progression through author-defined tags, variables, metadata, chapters, themes, arcs, endings, and configurable state/gauge presentation. These are narrative organization and authoring concepts, not built-in RPG management systems. The system must not ship predefined equipment, pets, inventory, shop, rarity, crafting, character-build, skill-tree, loot, or resource-management gameplay. Any such concepts may exist only as user-authored data labels interpreted by custom content, not as built-in gameplay loops, UI systems, or product features. The visible gameplay remains pure card text plus binary left/right choices.

## 1. Core Architecture (Decoupled Design)
- **Module A: ReignsAgent-Core**: Headless runtime. Handles default four gauge/faction values (0-100), loops, game-over, variable/tag state, and card scheduler. No UI/IO, no AI, and no hard-coded chapter or RPG systems.
- **Module B: ReignsAgent-Pipeline**: Handles local JSON/CSV import/export and LLM API connectors for automated content & asset generation.
- **Module C: ReignsAgent-Reviewer**: Independent Monte Carlo simulation engine. Runs 100k cycles headlessly, generates JSON diagnostic reports for narrative coverage and balance, and feeds back to Module B for self-correction.

## 2. Extensibility Specification
- **Variable Store**: Must support a dynamic low-level variable/tag store for user-authored content state, including narrative progression state.
- **Narrative Organization Labels**: Content authors may define chapters, themes, arcs, endings, status labels, and gauge presentation through data and metadata. These labels must remain author-owned and data-driven unless a later reviewed schema explicitly promotes them.
- **Custom Data Labels**: Content authors may use arbitrary labels in their own data, but the engine must not ship predefined equipment, pet, shop, rarity, crafting, class, skill-tree, loot, or inventory-management concepts.
- **Lifecycle Hooks**: Variable/tag hooks may implement `on_acquire`, `on_tick`, and `on_dismiss` to modify card pool weights and faction scales dynamically. These hooks are engine-level extension points only, not a mandate to build item systems or UI.
- **AI Assist Boundary**: AI Assist is a creator-side workflow for request planning, contextual draft generation, review repair, visual request preview, and patch proposal application. Core and deployable player builds must not contain provider SDKs, API keys, network AI calls, generated-edit tooling, or AI-specific gameplay behavior. AI output must flow through explicit proposals, editor validation, player validation where relevant, and undo/draft history before it becomes authored content.
- **AI Endpoint UX**: The default creator UX should prefer lightweight user-supplied endpoint configuration (base URL, API key, protocol, model id, and capability flags) over heavy provider-profile management. Multiple profiles, provider presets, model discovery, MCP, skills, and arbitrary agent tools are optional developer-mode enhancements unless a later reviewed plan promotes them.
- **Desktop Host Boundary**: Electron is an optional outer host only. `apps/desktop-electron` may start the shared Creator Server and load the compiled WebUI, but Core, Pipeline, Reviewer, Interface, Creator Web, and Creator Server must not import Electron or depend on desktop-only APIs.

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
- `apps/creator-web`: Vite/React creator dashboard workspace. It consumes the existing local API and keeps visual skins isolated from core product logic.
- `apps/creator-server`: Shared local HTTP API and static Creator host used by development, the Node ZIP, and desktop runtime staging.
- `apps/desktop-electron`: Optional Electron lifecycle, security, and installer shell. It contains no game, generation, review, or editor business logic.
- `packages/core`: Pure headless game runtime. No UI, IO, AI generation, or deployment logic.
- `packages/reviewer`: Headless Monte Carlo simulation, graph diagnostics, and balance reports.
- `packages/pipeline`: Local import/export, content bundle handling, generation request contracts, and reviewer feedback actions.
- `packages/interface`: Creator workflow orchestration plus legacy web dashboard/player surfaces and deployable player templates.
- `scripts`: Local tools including thin server launchers, runtime assemblers, content CLI, build-game assembler, and verification gates.
- `fixtures`: Sample and validation content used by tests and local demos.
- `test`: Cross-package integration tests.

## 5. Planning Source
Product roadmap, dashboard restructuring notes, and near-term architecture plans live in `ROADMAP.md`. Keep this file focused on durable project rules and agent constraints.
