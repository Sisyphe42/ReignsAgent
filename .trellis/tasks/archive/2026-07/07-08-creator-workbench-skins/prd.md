# Add creator workbench skins

## Goal

Add two creator workbench skin options and update the default skin so new or reset workbench sessions open with a GitHub Light look. The skin selector should also expose the updated workbench skin name requested by the user.

## Background

- User requested a new branch/PR for: "Add skin: Github Light (default), Catppuccin Latte. edit workbench skin name."
- This is a lightweight visible frontend change. It should follow existing skin configuration patterns and avoid changing core, reviewer, pipeline, or AI behavior.

## Requirements

- Add a `Github Light` skin option for the creator workbench.
- Make `Github Light` the default skin used when no saved/explicit skin is selected.
- Add a `Catppuccin Latte` skin option for the creator workbench.
- Update the existing workbench skin display name as requested, preserving existing behavior unless the implementation reveals a more precise migration need.
- Keep the change contained to workbench/creator interface skin configuration and supporting tests/docs if required by the existing codebase.

## Out of Scope

- Player-facing deployable game skin changes.
- New gameplay, AI assist, provider, import/export, reviewer, or core runtime behavior.
- A broad visual redesign beyond adding/selecting the requested skins and label/default updates.

## Acceptance Criteria

- [x] The skin selector includes `Github Light` and `Catppuccin Latte`.
- [x] `Github Light` is the default workbench skin for sessions without a saved skin preference.
- [x] The requested workbench skin display name is updated everywhere user-visible skin names are defined.
- [x] Existing skin behavior remains available unless explicitly replaced by the requested name/default change.
- [x] `npm run verify` passes before commit.

## Verification

- `npm run verify` passed.
- `npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>` passed.
- Local browser smoke verified `/workbench` defaulted to `datasetSkin: "workbench"` with selected label `Github Light`, switching to `catppuccin-latte` set `?skin=catppuccin-latte`, and `/play?skin=catppuccin-latte` accepted the new skin.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
