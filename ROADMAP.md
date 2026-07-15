# ReignsAgent Roadmap

## Current Direction
ReignsAgent now has a creator-focused workspace for building, reviewing, previewing, and shipping Reigns-like card narratives. Local Web, the Node ZIP, and portable Electron ZIPs share the Creator Server and filesystem Workspace; the Hosted PWA uses OPFS and a browser backend over the same domain contracts.

The current priority is depth rather than another host or shell: make Content, Story, Review, AI Assist, and the production player clearer and more actionable for non-technical authors while keeping backend and package boundaries stable.

Story and Content work should now optimize for non-technical content authors: the creator surface should explain what each card does, when it appears, how it moves the story, what is broken, and what the next repair action should be.

## Delivered Creator And Distribution Baseline

Recent merged work established the baseline that future phases should preserve:

- PR #21 shipped one React Creator across local Web, a cross-platform Node ZIP, portable Electron ZIPs, and an offline-capable Hosted PWA. It also delivered durable TOML configuration, multi-project filesystems, OPFS persistence, Workspace/project ZIP interchange, direct-CORS Hosted AI, and shared release verification.
- PR #22 made explicit workbench routes authoritative over persisted panel state, anchored packaged Creator exports under `ReignsAgentData/Builds` independently of the launch working directory, and added cached-shell fallback for non-success Hosted navigations.
- PR #24 delivered responsive pinned/compact/floating navigation, desktop-only panel shortcuts, project management in the header, client-aware English/Simplified Chinese locale controls, and Player launch/return context preservation.
- Windows Project release packaging now publishes a validated active Project as a single x64 EXE from local Node/Electron Creator, with deterministic build IDs, project-scoped release history, portable `Builds` output, and a restricted native WebView2 host. Hosted Creator retains Web Player ZIP export.
- `/workbench` is the primary Creator surface, with overview, content, story, review, AI Assist, preview, build, and settings panels over shared backend contracts.
- Review diagnostics and seeds remain creator-facing and reproducible; developer preview may expose debug state while the production player remains focused on play.
- Skins remain a presentation layer shared through configuration and URL context rather than a dependency of Creator workflows or player behavior.

## Near-Term Creator Priorities

- Replace remaining implementation-shaped controls and raw fields with author-facing summaries, explanations, repair actions, and progressive disclosure.
- Tighten project lifecycle UX around blank, sample, import, backup/restore, rename, and destructive actions without weakening portable or Hosted persistence contracts.
- Continue cross-skin, responsive, keyboard, and Simplified Chinese visual QA as panels gain richer content.
- Keep direct routes, Player return context, client-local navigation preferences, and shared locale behavior covered by Hosted browser tests.
- Close the #24 post-merge storage-resilience follow-up by making optional rail-preference reads and writes tolerate unavailable or throwing `localStorage` without blocking Creator startup.
- Preserve existing API endpoints and content bundle schemas unless a reviewed contract change justifies migration.

## Story/Content Completion Direction
- Keep the player interaction model pure: card text plus binary left/right choices. Add richness through authored narrative state, not through inventory, equipment, shops, builds, or other RPG management loops.
- Treat chapters, themes, arcs, endings, and status as data-driven authoring concepts expressed through tags, variables, and metadata. Core must not hard-code chapter progression rules; it should keep handling generic eligibility and state.
- Reframe Content from a field editor into a card authoring desk: human-readable card summaries, appearance-condition explanations, choice-consequence explanations, validation messages, and repair links should be visible before raw JSON or advanced state editing.
- Reframe Story from a graph visualizer into a story structure workspace: graph navigation, chapter/theme grouping, reachability, reviewer coverage, ending paths, breakpoints, and issue navigation should all point back to concrete editing actions.
- Reframe Review from a balance-only panel into narrative QA. Keep gauge pressure, game-over rate, and coverage, but add pacing, dead paths, early endings, unreachable story groups, unvisited endings, and chapter/theme coverage as review concerns.

## AI Assist Direction
- Replace the legacy AI Edit framing with AI Assist: a context-aware creator assistance layer over Overview, Content, Story, and Review. It should not become a chat-first product or a separate editing mode that hides the normal workflow.
- Settings should support user-supplied endpoints with a NewAPI-style channel setup: provider channel type with official/brand logo, API key with show/hide control, editable model presets/model id, editable base URL, real backend validation, optional `/models` fetch, and capability toggles for vision, structured JSON, tool/function calling, reasoning/thinking, and streaming. Protocol, route mode, compatibility family, and JSON mode preference belong in Advanced. Image or vision endpoints may be configured separately only when the call shape requires it.
- Avoid profile-management burden in the default UX. Lightweight frontend-owned endpoint/model presets and a manual `/models` metadata probe are acceptable; provider profile management, automatic model discovery, multiple saved profiles, MCP, skills, and raw tool integrations are optional developer-mode enhancements after the basic endpoint and action flow works.
- Overview should handle empty/sample initialization with a brief composer and safe actions for blank project, sample, import, or generated draft. Full regenerate and clear belong in project settings or a project menu with destructive styling and confirmation.
- AI entry points should be contextual: selected cards, graph nodes/edges, review issue cards, and overview project state open the same action popover/drawer with context summary, recommended actions, optional prompt, draft preview, and apply controls.
- Review should become the strongest AI-assisted diagnostics surface: coverage matrices, ending reachability, gauge pressure, issue cards, and repair proposals should be visible before AI generates fixes.
- AI work needs explicit interaction states. Simple edits should show inline loading; longer edits should show progress stages such as context, request, model response, parse, validate, and ready. User-facing errors should offer retry; raw call details belong in Dev Mode logs.

## Data Direction
- Do not migrate the content schema during the docs-first phase.
- Prefer lightweight metadata before engine contracts: `metadata.story.groups` describes chapters, themes, arcs, and ending groups; `metadata.presentation.gauges` can rename, describe, or hide the default four neutral gauge slots (`gauge0` through `gauge3`) without creating new built-in stats.
- Cards should continue to express progression through `requirements`, choice `effects.tags`, and choice `effects.variables`. Current requirements may combine tag gates, exact variable gates, and default-gauge threshold gates through `requirements.factions`; this remains story eligibility data, not a new player stat model. Legacy `faith`/`people`/`military`/`treasury` keys are import aliases only.

## Later Architecture Options
- `packages/contracts`: Shared schemas for cards, content bundles, diagnostics reports, connector requests, and build manifests.
- Fastify remains an optional future transport upgrade if the shared `apps/creator-server` HTTP implementation outgrows Node's built-in server.
- Extend the hosted Reviewer Worker with richer incremental progress and resumable runs beyond the bounded v1 workload.
- Production player surface evolution: build on the shipped Web runtime and Windows native host with animation, settings, language switching, interaction preferences, about/attribution, custom icons, signing, and additional platforms only through reviewed release work.

## Distribution Evolution
- Preserve Browser/Vite development, the Node ZIP, and Electron as parallel hosts over the same WebUI and local API.
- Keep Electron isolated in `apps/desktop-electron`; no package or Creator Web code may import desktop APIs.
- Preserve the utility-process Creator Server, ZIP-only Windows x64/macOS x64+arm64/Linux x64 Creator outputs, and beside-app `ReignsAgentData` portability model. ZIP-only constrains Creator Electron distributions, not single-file Project player releases.
- Keep Windows Project EXEs player-only: embedded authored content, Core/player runtime, and assets are allowed; Creator, Pipeline, Reviewer, AI connectors, settings, and credentials are forbidden.
- Preserve the shared TOML/file Workspace contract for Electron, Node ZIP, and local Web, and the equivalent Hosted OPFS projections owned by `apps/creator-web`.
- Keep Hosted AI direct-CORS only; do not introduce a public relay or compile server secrets into the static application.
- Treat signing, notarization, publishing, automatic updates, native file dialogs, menus, notifications, and protocol handlers as later opt-in release work rather than v1 shell requirements.

## Non-Goals For The Current Phase
- No full engine migration to Unity, Godot, or another game editor.
- No Fastify or database introduction.
- No content schema migration.
- No default multi-provider/profile management system before the lightweight AI Assist endpoint UX is proven.
- No MCP/skills/tool-agent surface in the normal creator UX.
- No second Creator frontend or host-specific fork of the shared WebUI.
- No built-in RPG management systems such as inventory, equipment, pets, shops, rarity, crafting, character builds, skill trees, or loot progression.
