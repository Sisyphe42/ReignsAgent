# Design

## Experience

Keep the existing court-decision stage as the single visual focus. Add two quiet utility controls in the masthead: `Appearance` and `Record`. Each opens a right-side vellum-like drawer layered over the court, so utility UI never competes with the binary decision.

The memorable motion remains the decree itself: the chosen card rotates and departs in the selected direction, the next card enters from the opposite edge, and a brief circular seal lands at center. Reduced-motion mode replaces the sequence with an immediate content update.

## State and persistence

- `reigns-agent.player.skin.v1`: one normalized skin ID shared across standalone releases. Skin IDs, labels, swatches, and semantic tokens come from `packages/interface/web/skin-catalog.js`, which is also consumed by Creator and embedded in Web/Windows player releases.
- `reigns-agent.player.history.v1:<build-id>`: a bounded JSON array of decision records for that build.
- `reigns-agent.player.reign.v1:<build-id>`: the next local reign sequence number.

All reads and writes go through guarded helpers. Invalid JSON or unavailable storage falls back to an empty history/default skin without blocking runtime startup. History is capped to the newest 200 decisions.

## Decision record

Each successful swipe writes a generated record ID, reign number, resulting turn, ISO timestamp, card ID/text, direction, choice label, and before/after visible gauge maps. Rendering uses DOM text nodes rather than interpolating authored strings into HTML.

## Boundaries

No API or build-schema change is required. Data stays under the fixed virtual player origin inside WebView2's existing per-project user-data folder. Restart creates a new reign marker but never restores runtime state or changes authored content.
