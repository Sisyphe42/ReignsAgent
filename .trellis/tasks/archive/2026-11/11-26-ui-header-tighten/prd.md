# Narrow-width top bar tightening

## Goal

Portfolio feedback (P14): at 834 px and 390 px the Creator top bar is too tall and the Project /
Skin dropdowns are too wide. Tighten the bar on the `fix/ui-polish-states` branch (PR #44).

## Requirements

1. **Content-sized controls.** The Project trigger and the Skin select take the width of what
   they show, between a floor and a cap; a long project name ends in an ellipsis with the full
   name as a tooltip. They no longer fill a row.
2. **Tablet (721–980 px, measured at 834).** Brand, Project, Skin, AI capsule and Player share one
   row. The project subtitle and the readout (secondary, repeated elsewhere) are hidden.
3. **Phone (≤ 800 px, measured at 390).** Two rows: brand + AI + Player, then Project + Skin. The
   Player button is compact, the AI capsule is just its orb. "Project" / "Skin" stay as
   accessible names.
4. **Desktop (1440 px).** Same style; the Project and Skin controls are also content-sized.
5. Navigation tab strip and panel layout do not regress; no horizontal page scroll.
6. 7-skin contrast tests still pass.

## Constraints

- Creator Web only; no Core / Pipeline / Reviewer / API changes. AI only through mocks.

## Acceptance Criteria

- [x] Browser test: 834 px, 7 skins, top bar ≤ 64 px (was 133–140) and all controls on one row.
- [x] Browser test: 390 px, 7 skins, top bar ≤ 116 px (was 347–373), two rows, Player ≤ its label + 40 px (and ≤ 120) × 40,
      AI ≤ 40 wide, tab strip horizontal under the bar.
- [x] Browser test: Project trigger ≤ max(120, name width + 60); Skin select ≤ shown skin text
      width + 60; long name capped (1440: 240, 834: 200, 390: 220) with ellipsis and title.
- [x] Browser test: no horizontal scroll and no top bar element outside the viewport; top bar text
      AA contrast on every skin.
- [x] `npm run verify`, `npm run test:hosted`, `npm run eval:repair` pass.
