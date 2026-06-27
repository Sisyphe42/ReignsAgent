# ReignsAgent Roadmap

## Current Direction
ReignsAgent is moving from a functional prototype toward a creator-focused workspace for building, reviewing, previewing, and shipping Reigns-like card narratives.

The current priority is the dashboard experience. Backend and package boundaries should remain stable while the creator UI becomes easier to navigate and reason about. The backend dev server should stay API-only; the creator UI should live on the Vite dashboard.

Story and Content work should now optimize for non-technical content authors: the creator surface should explain what each card does, when it appears, how it moves the story, what is broken, and what the next repair action should be.

## Dashboard-First Refactor
- Start the dashboard migration with `apps/creator-web`, a Vite/React creator workspace that consumes the existing local API.
- Make the React workbench the primary creator surface (`/workbench`) in the Vite dashboard. Keep the backend server API-only during development.
- Reframe the dashboard as a project workspace with separate panels for overview, card content, story/endings, review diagnostics, developer preview, build/export, and settings.
- Preserve existing API endpoints, content bundle schema, localStorage draft restore, and player preview behavior.
- Treat review diagnostics and seeds as creator-facing tools: visible enough for debugging and reproducible balancing, but not player-facing game UI.
- Keep developer preview and production player related but distinct. Developer preview may show debug state; production player should focus on final player experience.
- Keep game-flavored UI styling as a global skin/theme layer that can travel across workbench, preview player, and deployable player through shared state and URL parameters. Do not bind creator workflows or deployable player behavior directly to a single visual CSS framework.

## Story/Content Completion Direction
- Keep the player interaction model pure: card text plus binary left/right choices. Add richness through authored narrative state, not through inventory, equipment, shops, builds, or other RPG management loops.
- Treat chapters, themes, arcs, endings, and status as data-driven authoring concepts expressed through tags, variables, and metadata. Core must not hard-code chapter progression rules; it should keep handling generic eligibility and state.
- Reframe Content from a field editor into a card authoring desk: human-readable card summaries, appearance-condition explanations, choice-consequence explanations, validation messages, and repair links should be visible before raw JSON or advanced state editing.
- Reframe Story from a graph visualizer into a story structure workspace: graph navigation, chapter/theme grouping, reachability, reviewer coverage, ending paths, breakpoints, and issue navigation should all point back to concrete editing actions.
- Reframe Review from a balance-only panel into narrative QA. Keep gauge pressure, game-over rate, and coverage, but add pacing, dead paths, early endings, unreachable story groups, unvisited endings, and chapter/theme coverage as review concerns.

## Data Direction
- Do not migrate the content schema during the docs-first phase.
- Prefer lightweight metadata before engine contracts: `metadata.story.groups` describes chapters, themes, arcs, and ending groups; `metadata.presentation.gauges` can rename, describe, or hide the default four neutral gauge slots (`gauge0` through `gauge3`) without creating new built-in stats.
- Cards should continue to express progression through `requirements`, choice `effects.tags`, and choice `effects.variables`. Current requirements may combine tag gates, exact variable gates, and default-gauge threshold gates through `requirements.factions`; this remains story eligibility data, not a new player stat model. Legacy `faith`/`people`/`military`/`treasury` keys are import aliases only.

## Later Architecture Options
- `packages/contracts`: Shared schemas for cards, content bundles, diagnostics reports, connector requests, and build manifests.
- `apps/creator-server`: A future Fastify-based creator API if the local dev server outgrows the current script.
- Reviewer workers: Worker-thread or job-backed diagnostics for large Monte Carlo runs.
- Production player shell: A dedicated deployable player surface with animation, settings, language switching, interaction preferences, about/attribution, and polished runtime UX.

## Non-Goals For The Current Phase
- No full engine migration to Unity, Godot, or another game editor.
- No Fastify or database introduction.
- No content schema migration.
- No built-in RPG management systems such as inventory, equipment, pets, shops, rarity, crafting, character builds, skill trees, or loot progression.
