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
- Define an explicit placement policy for every guided step. Panel headers and fixed top-bar controls return the guided surface to its natural start; only lower-page targets that need it use centered scrolling. Do not infer that every spotlight must be mathematically centered.
- Add trailing scroll room only when lower-page targets need room to become visible or centered. Do not add leading padding that shifts the normal panel layout.
- Track target geometry through captured scroll events and `ResizeObserver`. Do not use a fixed timeout as the source of truth for target readiness or final spotlight placement.
- Use deterministic `auto` scrolling when a step changes. Do not leave a smooth-scroll animation running across the next step transition; it can make adjacent targets depend on navigation timing and direction.
- Reconcile the declared placement for multiple animation frames after a step or panel change, and restart reconciliation when the target, guided surface, viewport, or document fonts change. Updating spotlight geometry without reapplying the step's placement policy is not sufficient.
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

### AI Outcome Notices

When an AI Assist run ends without a draft, the panel copy comes from `apps/creator-web/src/ai-status-copy.js`, not from inline string concatenation:

- The author's Cancel is not a failure. It uses the neutral tone (`role="status"`, no error red), the title "Cancelled", says which rounds finished and that no card changed, and offers "Build again". The interrupted progress step and repair-loop phase use the `--cancelled` classes, never `--failed`.
- Advice follows the failure type: 5xx / 408 / 429 / network / timeout say the endpoint is temporarily unavailable and to retry later (never "edit the prompt"); 401 / 403 / 404 point at Settings; other 4xx and parse / invalid-response failures suggest editing the prompt; the session request limit points at Settings only.
- Image operations follow the same rules through `describeImageFailure`: `runImageOperation` resolves to `{ failure: { code, message, stage } }` instead of `false`, so a refused image prompt keeps "Edit prompt" and an outage only offers Retry. Never replace the classified notice with one fixed image error.
- Compose sentences with `joinSentences` / `toSentence` so a message that already ends in a period never becomes "..".
- Repair-loop stop text comes from `repairStopLabel` and names rounds explicitly ("Passed in round 2 of 3: ..."); do not reintroduce phrases like "the first round with ..." that read as round 1.

### Narrow Navigation

At 800 px and below the rail is a horizontally scrolling tab strip declared at the end of `styles.css` with skin-proof selectors. Tabs size to icon + full label + state badge (`min-width: max-content`); labels are never ellipsized, only the strip scrolls, and the active tab is scrolled into the strip on panel change. Skin rules must not pin a fixed tab width at this breakpoint.

### Narrow Layout and Labels

- Single-column grids that hold author or model content use `minmax(0, 1fr)`, never bare `1fr`: a long unbreakable line (a draft's JSON in a `<pre>`) must scroll inside its own box instead of widening the column, the page, and the navigation strip. This applies to `.workspace` at 800 px and below, `.ai-edit-layout` at 960 px and below, and `.ai-proposal-list`.
- Rows of short status labels (the six `.ai-progress` steps) must not clip a label on any skin. Use `flex: 1 1 0` with `min-width: max-content` and `flex-wrap`, so the row stays even when it fits and wraps when a skin's font is wider; do not use a fixed `repeat(n, minmax(0, 1fr))` grid for labels.
- Status text keeps one phase word followed by details joined with " · " in a single text node (`Simulating · 6,600 / 10,000 cycles · about 1s left`), so the sentence reads the same in `textContent` and screen readers.

### Author-Facing Names and Author Text

- Internal routing names never reach the author. AI request sources go through `aiSourceLabel` / `aiRequestLabel` (the floating selection layer's stored source `Ambient` shows as "Selection"); keep the stored value so older history records still match.
- Quote author text with `QuotedText`. It tags Chinese / Japanese / Korean content with its own `lang` so the quote and full-width punctuation share one CJK font, which avoids `记录。 ”` in the English UI.
- Long author text fields (card text) use the growing `AutoGrowTextarea`; Enter saves a one-paragraph field, Shift+Enter breaks a line, and IME composition Enter never saves.
- Phantom paints panels as cream paper while `--bg` stays near-black. Any chip or step tinted from `--bg` needs an explicit Phantom paper colour per state; check it with `scanContrast({ root, composite: true })` from `test/browser/contrast-scan.js`, which blends translucent tints onto the paper below.

### Top Bar Controls

- Header controls are content-sized. The Project trigger's bounds (`--project-trigger-min` / `--project-trigger-max`) sit on the `.project-menu` `<details>` flex item, not on the trigger, so the intrinsic width the bar lays out from already respects the cap; a percentage inside `min()` on the trigger is ignored during intrinsic sizing and lets a long name widen the row. Long names end in an ellipsis with the full name in `title`. The skin `<select>` uses `field-sizing: content`.
- The bar is one row at every width and degrades in priority order (viewport media queries; the bar always spans the viewport and lines up with the rail's 800 px switch): 1360 px the readout leaves (repeats rail badges); 980 px one flex row, the project subtitle (repeats the trigger) and the AI wave (decoration) leave; 800 px the "Project" / "Skin" words and the AI state copy become visually hidden accessible names; 600 px (phone) the Skin select leaves the bar with `display: none` and Project / AI / Player grow to 44 × 44 touch targets, the project list opens as a sheet anchored to the bar; 480 px the "ReignsAgent" wordmark is visually hidden (still the page's `h1`) and the logo carries the brand. Do not reintroduce a wrapping second row.
- The phone bar holds exactly logo, Project, AI and Player. Skin lives in Settings > Interface next to Language (`.interface-settings__skin`, always rendered, bound to the same `changeSkin`), so a phone never needs an overflow menu for it.
- `test/browser/ui-header.spec.js` holds the height caps (834 px ≤ 64, phone ≤ 64), the 320–980 px no-wrap sweep for all skins, the phone touch-size and four-control checks, the content-width checks and the per-skin top bar contrast; change the caps there only with new measurements.

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
