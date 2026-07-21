# Design

## Player utilities

Keep the existing right-side utility drawer, but make it a four-view surface: Appearance, Language, Record, and About. Language is shown only when the build declares more than one supported locale. Utility chrome is translated by a small player-owned English/Simplified Chinese dictionary; authored cards remain localized by `createPlayer().setLocale()`.

## Reign record

Retain the validated bounded decision storage for compatibility, but project it into session groups keyed by `reign`. A Reign group owns its start/end timestamps, decision count, and nested decision rows. This avoids a breaking local-storage migration while making the user-visible unit a play session.

## Motion

Use the Web Animations API for outgoing and incoming card keyframes, with CSS as visual styling rather than lifecycle coordination. Await animation completion, then mutate the headless runtime exactly once. `prefers-reduced-motion` remains an immediate path.

## Skins and credits

Semantic colors continue to come from `skin-catalog.js`, shared with Creator. Player CSS may react to `data-skin` for composition-specific typography, patterns, borders, and shadows. About reads existing build metadata only; no Creator or network code is shipped.

## Metadata

Project `author` and `description` remain optional metadata fields persisted through the existing generic metadata PATCH route. No content or build schema migration is required.
