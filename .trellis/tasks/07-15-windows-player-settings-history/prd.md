# Windows player settings and history

## Goal

Add persistent skin controls, local decision history, and richer directional card transitions to deployable players.

## Requirements

- Add an in-player settings drawer with all supported skins. A selected skin applies immediately and persists locally for the next launch; an explicit URL skin remains the initial override.
- Add a project/build-scoped local game record containing each completed decision, its card and choice labels, before/after gauge values, turn, and timestamp.
- Let players inspect the newest records, see the current reign summary, and explicitly clear stored records. Storage failures must not prevent play.
- Strengthen card transitions so the outgoing card leaves toward the chosen direction and the incoming card arrives from the opposite side with a short stamped reveal.
- Keep keyboard, button, and drag input single-flight; honor `prefers-reduced-motion`.
- Keep settings and records inside the deployable player only. Do not add Creator, API, or authored-content schema dependencies.

## Acceptance Criteria

- [ ] Every supported skin can be selected in the player and survives reload when local storage is available.
- [ ] Each successful choice creates one validated record; failed or overlapping choices create none.
- [ ] Restart starts a new local reign without deleting earlier records; clear history requires an explicit action.
- [ ] The history drawer is keyboard accessible, responsive, and reports an actionable empty state.
- [ ] Directional exit/entry animations are visible in normal motion mode and effectively disabled for reduced motion.
- [ ] Web player, real Windows EXE, packaged Electron, and `npm run verify` pass.

## Notes

- Persistence uses the WebView2 user-data folder already owned by the native host and does not write beside the EXE.
