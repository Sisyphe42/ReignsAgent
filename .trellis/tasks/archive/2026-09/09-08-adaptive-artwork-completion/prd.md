# Complete adaptive artwork experience

## Goal

Complete the existing adaptive artwork experience with usable authoring feedback and credible cross-surface regression coverage.

## Requirements

- R1: Provide a useful square artwork preview beside the fit/focal controls, with localized English/Chinese labels and short explanations of each mode.
- R2: Preserve authored fit and focus during rapid control interaction; surface save failures without misleading saved state.
- R3: Verify actual Creator, Shared/Hosted Player, and Standalone Player rendering with landscape, portrait, and square sources in every fit mode, including broken-image recovery.
- R4: Preserve the established optional metadata contract, original image bytes, 1:1 frames, and AI comparison behavior.

## Acceptance Criteria

- [x] The editor provides a readable preview and localized accessible controls at desktop and mobile widths.
- [x] Rapid fit/focus changes persist consistently; failed saves remain visible and recoverable.
- [x] Browser tests exercise real asset-shaped inputs and all three modes, not only default fallback.
- [x] Broken images hide safely and subsequent valid images recover on each surface.
- [x] Required verify, Hosted, and standalone build checks pass.

## Notes

- Existing work is on feature/adaptive-card-art. User changes to package.json and package-lock.json (thinking-orbs) are outside this task.
- Evidence: test/browser/hosted.spec.js:349 passes a display object to applyCardArtworkDisplay, although packages/interface/web/assets/card-artwork.js expects an asset with metadata.display.
- Evidence: apps/creator-web/src/main.jsx:2331 has untranslated fit/focal controls and only the 50px heading thumbnail for immediate feedback.
- Out of scope: crop tools, image-processing dependencies, new aspect ratios, schema expansion, PR creation or merge without explicit authorization.
