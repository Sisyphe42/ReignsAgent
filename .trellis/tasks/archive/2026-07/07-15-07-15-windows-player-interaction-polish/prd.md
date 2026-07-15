# Windows player interaction and release presentation

## Goal

Fix DPI-correct click interaction and restart behavior in Windows release players, then give the standalone player a dedicated release presentation and purposeful card motion.

## Requirements

- Windows x64 player controls must receive pointer input at the same visual coordinates at 100%, 125%, 150%, and per-monitor DPI changes.
- Left and right choice buttons must perform the same action as swipe and keyboard controls, with one decision accepted at a time.
- Restart must start a fresh reign immediately from any running or ended state; it must not require a hidden confirmation gesture.
- The deployable player must use a dedicated release presentation rather than the Creator preview shell while retaining authored skin, gauge, card art, localization, and presentation policy.
- Card transitions must communicate direction and state without blocking reduced-motion users or keyboard interaction.
- The player remains offline, player-only, and free of Creator/editor/AI functionality.

## Acceptance Criteria

- [ ] Native host is per-monitor DPI aware and keeps WebView bounds/visibility correct across resize, minimize, restore, and DPI changes.
- [ ] Mouse click, keyboard, and drag choices advance exactly one card; controls cannot double-submit during a transition.
- [ ] Restart works with one click and resets turn/session presentation.
- [ ] Generated EXE opens on a distinct release-player layout with responsive card staging and directional motion.
- [ ] Reduced-motion mode removes nonessential transitions while keeping all controls usable.
- [ ] Deployable build, Windows player smoke, packaged Electron smoke, and `npm run verify` pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
