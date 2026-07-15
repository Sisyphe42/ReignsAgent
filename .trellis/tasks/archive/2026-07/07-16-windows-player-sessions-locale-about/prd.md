# Windows player sessions, locale, and about

## Goal

Make the release player feel like a finished product: its record is organized by complete reigns, authored bilingual content can be switched in place, motion is reliable, distinctive shared skins remain recognizable, and project credits are visible.

## Requirements

- Present local history as reign sessions, with decisions nested within each `Reign XX` group and the masthead count representing reigns.
- Replace timing-dependent card classes with a reliable transition sequence while preserving reduced-motion behavior and single-flight input.
- Continue consuming the shared Creator skin catalog; add player presentation treatments that make Famicom and Phantom visually distinctive without introducing duplicate skin definitions.
- Read `metadata.i18n` from the build, expose supported languages, persist the selected locale per build, and switch current card/choice content through the existing player runtime.
- Add localized release-player chrome for English and Simplified Chinese so the bundled bilingual sample is usable end to end.
- Add an About view containing ReignsAgent framework/runtime attribution and authored project title, version, author, and description.
- Let creators edit project author and description alongside the title through existing metadata persistence.

## Acceptance Criteria

- [ ] Record shows newest reigns first and decisions in chronological order within each reign.
- [ ] A click, keyboard choice, or swipe visibly animates in full-motion mode and never duplicates a decision.
- [ ] Famicom and Phantom use the same catalog IDs/tokens as Creator while gaining clearly different release-player compositions.
- [ ] The sample release switches English and Simplified Chinese without restarting or losing the current reign.
- [ ] About shows framework attribution plus authored project metadata, and Creator can edit those fields.
- [ ] Web player, real Windows EXE, packaged Electron, deployable player build, and `npm run verify` pass.
