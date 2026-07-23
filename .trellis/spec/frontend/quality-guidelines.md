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

### Guided Target Lifecycle

Multi-step guidance that changes Creator panels must use one direction-independent target lifecycle:

- Update the guide step and its required panel in the same React event batch. Do not change the step first and repair the panel later from an effect.
- Give every spotlight step a deterministic panel context, including top-bar targets. A step must not inherit whichever panel happened to be active from the navigation direction.
- Treat target mounting as asynchronous. Resolve the target immediately when available and otherwise wait with a scoped `MutationObserver`; always disconnect observers during step cleanup.
- Preserve the Creator's natural leading layout. Never add top padding or a leading spacer to force early-page targets to the mathematical viewport center; use trailing scroll room only when document-end targets need room to center.
- Track target geometry through captured scroll events and `ResizeObserver`. Do not use a fixed timeout as the source of truth for target readiness or final spotlight placement.
- Use deterministic `auto` scrolling when a step changes. Do not leave a smooth-scroll animation running across the next step transition; it can make adjacent targets depend on navigation timing and direction.
- Recompute both spotlight geometry and card layout from the current viewport. Responsive checks must resize an already-open guide and verify internal content width and controls, not only the outer dialog bounds at initial load.
- Ignore off-screen or degenerate rectangles instead of rendering clipped spotlight geometry with negative dimensions.

Hosted regression coverage must traverse every guide step forward and backward. Panel-backed targets must be active and fully visible in both directions; document-end targets that require centering must be checked explicitly. Early panel steps must also assert that the stage stays at its natural top position so coordinate-only checks cannot hide a large artificial blank region. Testing only the final pair of steps is insufficient.

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
