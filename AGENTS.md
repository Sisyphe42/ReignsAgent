# ReignsAgent System Specification & Agent Guildlines

## 1. Core Architecture (Decoupled Design)
- **Module A: ReignsAgent-Core**: Headless runtime. Handles 4 factions (0-100), loops, game-over, and card scheduler. No UI/IO.
- **Module B: ReignsAgent-Pipeline**: Handles local JSON/CSV import/export and LLM API connectors for automated content & asset generation.
- **Module C: ReignsAgent-Reviewer**: Independent Monte Carlo simulation engine. Runs 100k cycles headlessly, generates JSON diagnostic reports, and feeds back to Module B for self-correction.

## 2. Extensibility Specification
- **Inventory System**: Must support a dynamic `Inventory` array.
- **Item Entities**: Supports Equipment, Pets, and active Status Effects.
- **Lifecycle Hooks**: Items must implement `on_acquire`, `on_tick`, and `on_dismiss` to modify card pool weights and faction scales dynamically.

## 3. Maintenance Protocols
- **Agent Duty**: Every time a new feature, module, or hook is implemented, the Agent MUST update this file under the `## 4. Implementation Progress` section.
- **Zero-Pollution Rule**: Do not mix Module A game logic with Module B AI generation logic.
- **Git & Review Rule**: The Agent must maintain a clean Git history. Never squash multiple phases into one commit. Ensure all unit tests pass *before* calling `git commit`. Include what was changed and what to review in the commit body.

## 4. Implementation Progress
- [x] Phase 1: Core Headless Runtime & Item Hook Architecture (Implemented in `packages/core`; abstract inventory/tag hooks only, no RPG UI systems)
- [x] Phase 2: Monte Carlo Simulation Bot & Graph Analyzer (Implemented in `packages/reviewer`; headless JSON diagnostics, default 100k cycles, no pipeline connectors)
- [ ] Phase 3: AI Pipeline Generator & Diagnostic Feedback Loop (Pending)
- [ ] Phase 4: Unified Playable Interface & Local Ingestion Dash (Pending)
