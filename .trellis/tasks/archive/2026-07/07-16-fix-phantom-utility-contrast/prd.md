# Fix Phantom utility contrast

## Goal

Correct Phantom release-player text contrast on raised utility cards without changing shared skin identity.

## Requirements

- Keep the Phantom utility drawer dark while rendering raised paper cards with dark readable text.
- Use semantic raised-surface text tokens rather than one-off Appearance-only overrides.
- Apply the same contrast treatment to Appearance, Record, Language, and About cards that share the raised surface.
- Preserve the canonical Phantom skin palette and player layout.

## Acceptance Criteria

- [x] Phantom Appearance skin names, descriptions, and motion choices are readable on their paper backgrounds.
- [x] Other skins retain their existing colors.
- [x] Other Phantom utility cards use the same readable raised-surface semantics.
- [x] Deployable player build, browser smoke, and repository verification pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
