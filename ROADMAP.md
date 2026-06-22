# ReignsAgent Roadmap

## Current Direction
ReignsAgent is moving from a functional prototype toward a creator-focused workspace for building, reviewing, previewing, and shipping Reigns-like card narratives.

The current priority is the dashboard experience. Backend and package boundaries should remain stable while the creator UI becomes easier to navigate and reason about.

## Dashboard-First Refactor
- Keep the native HTML/CSS/JS dashboard for now. Do not migrate to React, Vite, Fastify, or a larger backend framework in this phase.
- Reframe the dashboard as a project workspace with separate panels for overview, card content, story/endings, review diagnostics, developer preview, build/export, and settings.
- Preserve existing API endpoints, content bundle schema, localStorage draft restore, and player preview behavior.
- Treat review diagnostics and seeds as creator-facing tools: visible enough for debugging and reproducible balancing, but not player-facing game UI.
- Keep developer preview and production player related but distinct. Developer preview may show debug state; production player should focus on final player experience.

## Later Architecture Options
- `packages/contracts`: Shared schemas for cards, content bundles, diagnostics reports, connector requests, and build manifests.
- `apps/creator-web`: A future Vite/React dashboard if the native UI becomes too costly to extend.
- `apps/creator-server`: A future Fastify-based creator API if the local dev server outgrows the current script.
- Reviewer workers: Worker-thread or job-backed diagnostics for large Monte Carlo runs.
- Production player shell: A dedicated deployable player surface with animation, settings, language switching, interaction preferences, about/attribution, and polished runtime UX.

## Non-Goals For The Current Phase
- No full engine migration to Unity, Godot, or another game editor.
- No React/Vite migration.
- No Fastify or database introduction.
- No content schema migration.
- No new RPG-like gameplay systems.
