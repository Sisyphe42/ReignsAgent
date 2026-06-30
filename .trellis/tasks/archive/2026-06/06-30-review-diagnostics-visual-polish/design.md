# Review diagnostics visual polish design

## Boundaries

- Primary changes are in the Creator React frontend and CSS.
- Use current diagnostics fields: `healthScore`, `sampleSize`, `coverage`, `factions`, `narrative`, `warnings`, and `warningCounts`.
- Pass existing editor/card context into Review so target labels and focus actions can be author-friendly.
- Do not change Core, Reviewer, player runtime, or provider execution behavior.

## UI Model

- Review remains one panel with run controls at the top.
- After diagnostics exist, render compact operational sections:
  - Overview: health, headline, sample size, average turns, game-over/stalled rates, warning counts, gauge pressure.
  - Coverage: sorted card rows with visit and cycle bars; status tags for unvisited and low cycle.
  - Story: enhanced narrative group coverage and ending coverage using the existing `NarrativeCoverage` component.
  - Issues: warning cards with severity, details, target chips, Content focus, Story link, and AI repair.
- Use a local segmented control or compact section tabs to avoid overwhelming the page.

## Data Flow

- App passes `editor` and `onFocusCard` to `ReviewPanel`.
- `ReviewPanel` derives local maps:
  - card id -> card excerpt/metadata
  - low cycle card id -> rate
  - warning targets -> chip labels
- Issue-level AI repair calls the existing `onAiAction` preflight path with `source: "Review"`, contextual action ids, and warning-specific prompts.

## Compatibility

- Existing top-level Review `Repair`, `Explain`, and `Coverage` AI actions stay available.
- Existing `/api/diagnostics/run` response shape remains valid.
- Existing Story graph / Content focus behavior is reused instead of duplicated.

## Styling

- Dense tables/cards with small bars and chips.
- Use CSS variables and existing skin system.
- Avoid nested cards and oversized hero-style composition.
