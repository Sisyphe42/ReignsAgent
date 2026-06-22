# ReignsAgent Roadmap

## Current Direction
ReignsAgent is moving from a functional prototype toward a creator-focused workspace for building, reviewing, previewing, and shipping Reigns-like card narratives.

The current priority is the dashboard experience. Backend and package boundaries should remain stable while the creator UI becomes easier to navigate and reason about.

## Dashboard-First Refactor
- Start the dashboard migration with `apps/creator-web`, a Vite/React creator workspace that consumes the existing local API.
- Keep the native HTML/CSS/JS dashboard available as a classic fallback while the React workspace reaches feature parity.
- Reframe the dashboard as a project workspace with separate panels for overview, card content, story/endings, review diagnostics, developer preview, build/export, and settings.
- Preserve existing API endpoints, content bundle schema, localStorage draft restore, and player preview behavior.
- Treat review diagnostics and seeds as creator-facing tools: visible enough for debugging and reproducible balancing, but not player-facing game UI.
- Keep developer preview and production player related but distinct. Developer preview may show debug state; production player should focus on final player experience.
- Keep game-flavored UI styling as a skin/theme layer. Do not bind creator workflows or deployable player behavior directly to a single visual CSS framework.

## Later Architecture Options
- `packages/contracts`: Shared schemas for cards, content bundles, diagnostics reports, connector requests, and build manifests.
- `apps/creator-server`: A future Fastify-based creator API if the local dev server outgrows the current script.
- Reviewer workers: Worker-thread or job-backed diagnostics for large Monte Carlo runs.
- Production player shell: A dedicated deployable player surface with animation, settings, language switching, interaction preferences, about/attribution, and polished runtime UX.

## Non-Goals For The Current Phase
- No full engine migration to Unity, Godot, or another game editor.
- No Fastify or database introduction.
- No content schema migration.
- No new RPG-like gameplay systems.
