# Creator Web Optional Storage Resilience

## Goal

Keep Creator Web usable when optional browser `localStorage` is unavailable or throws during access, without changing durable Workspace or OPFS persistence.

## Confirmed Facts

- Rail collapsed and pinned preferences are client-local and currently read and written directly through `localStorage`.
- Legacy draft migration also reads and removes an optional `localStorage` entry.
- Hosted Creator already has browser tests for normal rail preference persistence.

## Requirements

- Add internal safe get, set, and remove operations for every Creator Web `localStorage` access.
- Treat missing storage, an accessor exception, or a method exception as an optional-storage failure and never block Creator startup or interaction.
- When rail preferences cannot be read, default to an expanded, pinned rail.
- When rail preferences cannot be written, preserve the current session's React state without showing an error.
- Treat an unavailable, unreadable, or malformed legacy draft as absent.
- Preserve normal storage behavior and keep API, Workspace, OPFS, and configuration contracts unchanged.
- Record the completed #24 storage-resilience follow-up in `ROADMAP.md`.

## Acceptance Criteria

- [x] Creator reaches its loaded state when the `window.localStorage` accessor throws.
- [x] Creator reaches its loaded state when `getItem`, `setItem`, and `removeItem` throw.
- [x] The unavailable-storage default is an expanded, pinned rail.
- [x] Rail controls continue to change in-memory UI state when preference writes fail.
- [x] Existing normal-storage navigation persistence remains green.
- [x] `npm run test:hosted` passes.
- [x] `npm run verify` passes.

## Out of Scope

- Workspace lifecycle UX, translation authoring, schema changes, and persistence migrations.
- User-facing warnings for optional preference-storage failures.
- Changes to the legacy dashboard under `packages/interface/web`.
