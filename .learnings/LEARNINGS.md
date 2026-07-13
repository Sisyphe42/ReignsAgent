## [LRN-20260713-001] correction

**Logged**: 2026-07-13T18:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Navigation density and navigation anchoring are separate state dimensions.

### Details
The first sidebar implementation made both the expand arrow and pin button mutate the same `railCollapsed` boolean. This produced only two observable states: a fixed full sidebar and a compact sidebar that expanded on hover. A proper Notion-like model needs the arrow to control fixed expanded versus fixed compact density, while pin controls fixed versus floating behavior.

### Suggested Action
Persist independent collapsed and pinned state, give each control one responsibility, and test all three observable modes. Keep navigation items laid out at their final expanded geometry while the compact rail clips them so width transitions cannot reflow labels or move icons.

### Metadata
- Source: user_feedback
- Related Files: apps/creator-web/src/main.jsx, apps/creator-web/src/styles.css, test/browser/hosted.spec.js
- Tags: sidebar, state-model, layout-stability

### Resolution
- **Resolved**: 2026-07-13T19:50:00+08:00
- **Commit/PR**: uncommitted by user request
- **Notes**: Added independent persisted pin and density state, fixed final-size item geometry, and covered fixed compact, floating reveal, and fixed expanded behavior in browser tests.

---

## [LRN-20260713-003] correction

**Logged**: 2026-07-13T22:45:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
An absolutely positioned Grid child must leave its grid area before using item-relative insets.

### Details
The rail icon was absolutely positioned but retained `grid-area: icon`. CSS Grid therefore used the icon grid area as its containing block, and the explicit inline inset was added from that shifted origin, moving icons right in every compact skin. A later Phantom descendant selector also overrode the base absolute positioning as a secondary skin-specific conflict.

### Suggested Action
Remove grid-area placement from absolutely positioned structural children, exclude them from broad skin selectors, and assert both centerX and centerY deltas for compact navigation icons.

### Metadata
- Source: user_feedback
- Related Files: apps/creator-web/src/styles.css, test/browser/hosted.spec.js
- Tags: css-cascade, skin, positioning, sidebar
- See Also: LRN-20260713-002

---

## [LRN-20260713-002] correction

**Logged**: 2026-07-13T20:20:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
A compact navigation item must be a complete compact component, not a clipped expanded component.

### Details
Keeping the expanded item width preloaded preserved icon geometry, but it also clipped the selected item border in compact mode. Compact and expanded items may use different complete widths and grids as long as their leading padding and icon column resolve to the same coordinates. Pin placement also needs to preserve the footer control's vertical position: pinned compact mode should show only the expand control, restoring Pin after expansion.

### Suggested Action
Give compact items a calculated width that fits between the rail paddings and divider, hide non-icon content rather than preloading it, and keep icon padding/column constants identical across both grids. Test complete compact borders, icon coordinates, and footer control positions.

### Metadata
- Source: user_feedback
- Related Files: apps/creator-web/src/styles.css, test/browser/hosted.spec.js
- Tags: sidebar, compact-state, selected-state, geometry
- See Also: LRN-20260713-001

### Resolution
- **Resolved**: 2026-07-13T22:30:00+08:00
- **Commit/PR**: uncommitted by user request
- **Notes**: Compact items now use complete calculated geometry, rounded skins round the active marker, and pinned compact mode exposes only the full-width expand control at the same footer position.

---
## [LRN-20260714-001] correction

**Logged**: 2026-07-14T01:27:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
Navigation icons must be balanced by optical weight, not normalized with one geometric scale.

### Details
A closed gear outline carries more visual mass than open line icons at the same nominal dimensions. Uniform numeric sizing or scaling therefore makes the set feel uneven. Review the rendered icon alongside its actual neighbors in expanded and compact navigation states, then tune silhouette size and stroke independently.

### Suggested Action
Use screenshots of the full icon column to compare occupied area, closure, stroke density, and negative space before choosing per-icon size and stroke adjustments.

### Metadata
- Source: user_feedback
- Related Files: apps/creator-web/src/main.jsx
- Tags: iconography, optical-weight, sidebar, visual-qa

### Resolution
- **Resolved**: 2026-07-14T01:30:00+08:00
- **Commit/PR**: uncommitted by user request
- **Notes**: Tuned the gear geometry and stroke independently after expanded and compact screenshot comparison.

---

## [LRN-20260714-002] best_practice

**Logged**: 2026-07-14T02:01:42+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
Geometry assertions for hover-reveal UI must establish the non-hover baseline and wait for scroll stability before measuring.

### Details
The Phantom floating-rail smoke clicked Unpin while the pointer remained over the rail footer, so its supposed collapsed baseline was still hover-expanded. Moving directly to a navigation item then sampled Linux Chromium during the hover interaction and produced a transient 2px vertical delta that did not appear on Windows.

### Suggested Action
Move the pointer outside the hover target, assert the compact width, reset scroll position, then trigger reveal and wait for both final width and scroll position before comparing bounding boxes.

### Metadata
- Source: error
- Related Files: test/browser/hosted.spec.js
- Tags: playwright, hover, animation, geometry, cross-platform
- See Also: ERR-20260714-001

### Resolution
- **Resolved**: 2026-07-14T02:01:42+08:00
- **Commit/PR**: uncommitted by user request, PR #24
- **Notes**: Corrected the Phantom test sequence; the target test passed 5 repeated runs, the hosted suite passed 6/6, and npm run verify passed.

---
