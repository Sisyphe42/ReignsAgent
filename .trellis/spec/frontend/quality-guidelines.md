# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

### Creator Skin Changes

Skin changes must stay consistent across the creator workbench, preview player, and deployable player template. Canonical IDs, labels, swatches, descriptions, and semantic tokens live in `packages/interface/web/skin-catalog.js`; surfaces may add layout treatments keyed by `data-skin` but must not duplicate the catalog.

Required touch points:

- `apps/creator-web/src/main.jsx`: update the `SKINS` selector list and keep `DEFAULT_SKIN` stable unless a migration is intentionally planned.
- `apps/creator-web/src/styles.css`: define or update the CSS custom properties used by the workbench and graph color reader.
- `packages/interface/web/skin-catalog.js`: update the canonical entry consumed by Creator and deployable players.
- `packages/interface/web/player.html`: verify preview skin selection and any preview-only composition treatment.
- `packages/interface/web/standalone-player.html`: verify deployable player composition treatments and the shared catalog import.
- `packages/interface/web/assets/dashboard.css`: update the legacy shared player/dashboard CSS variables when `/play` depends on them.
- `README.md`: update documented `?skin=` examples or default skin naming when user-visible behavior changes.

Why: skin state is shared through `localStorage` and the `skin` URL parameter. Missing one allowlist or template makes a valid workbench skin fall back to the default in player or deployable builds.

---

## Testing Requirements

For visible creator skin changes:

- Run `npm run verify`.
- If `packages/interface/web/standalone-player.html` changes, run `npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>`.
- Smoke test `/workbench` and `/play?skin=<new-skin>` locally and confirm the selector value, `document.documentElement.dataset.skin`, and core CSS variables match the expected skin.

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
