# AI Assist frontend UX shell

## Goal

Continue the `feature/ai-assist-ux` branch in the same PR by implementing the first creator-facing AI Assist UX shell: clear naming, endpoint configuration surface, visible assist mode state, Overview initialization entry, and polished draft/progress feedback over the existing deterministic AI edit plan/apply API.

## Requirements

- Keep PR #18 as the single PR for the whole branch; do not create a docs-only PR.
- Rename visible dashboard language from AI Edit toward AI Assist.
- Add a header AI Assist toggle with clear active, off, and unconfigured states.
- Add a lightweight Settings endpoint UI for base URL, API key, protocol, model id, and capability flags. Store this only in the creator browser state for now; do not export it to player builds.
- Add Overview initialization affordances for empty/sample projects with an optional brief and actions that route to AI Assist, import, sample, or blank-start paths where current APIs permit.
- Update the existing AI plan panel to show endpoint/configuration context and progress stages for draft generation.
- Preserve existing `/api/ai/edit/plan` and `/api/ai/edit/apply` behavior; this task does not implement real provider calls.

## Acceptance Criteria

- [ ] Creator rail/header uses AI Assist language.
- [ ] Settings exposes custom endpoint fields and capability toggles without requiring profile management.
- [ ] AI Assist toggle visually communicates off/active/unconfigured state.
- [ ] Overview gives a clear AI-assisted starting point for empty/sample authoring.
- [ ] AI Assist plan generation shows visible progress/loading states and proposal apply flow remains usable.
- [ ] `npm run verify` passes.

## Notes

- This is a UX shell over existing deterministic plan/apply behavior. Real LLM/image endpoint execution should be a later backend task.
