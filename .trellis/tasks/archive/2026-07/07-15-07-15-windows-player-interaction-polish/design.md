# Technical Design

## Native input alignment

- Declare the player process Per-Monitor V2 DPI aware in its Win32 manifest and set the process DPI awareness context before creating the window.
- Handle `WM_DPICHANGED` using the suggested window rectangle and continue sizing the WebView controller from the client rectangle.
- Keep controller visibility synchronized with minimize/restore.

## Release player presentation

- Keep `standalone-player.html` self-contained and offline.
- Use a court-decision stage: compact project/turn masthead, four-gauge instrument rail, central card, and two explicit decision tracks.
- Derive all color from the existing skin variables. Use local system typography only.
- Animate the card toward the selected side, update the runtime once, then introduce the next card on the center axis. Gate choice input while motion is active.
- Restart immediately constructs a new runtime from the embedded build and starts it; no confirmation state is retained.

## Validation

- Add static contract coverage for the DPI manifest/lifecycle and standalone interaction hooks.
- Build a deployable player, render it through HTTP/browser checks, and test the real EXE with mouse automation plus smoke mode.
