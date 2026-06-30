# Contextual AI Assist actions

## Goal

Make AI Assist available from the authoring surfaces where creators actually work by adding scoped action entry points in Content, Story, and Review that route into the existing AI Assist draft workflow with the relevant context.

## Requirements

- Keep all work on PR #18 / `feature/ai-assist-ux`.
- Show contextual AI Assist affordances only when the AI Assist layer is enabled, while still keeping direct navigation to the AI Assist panel available.
- Content should offer actions around the selected card, such as rewrite/expand/follow-up draft.
- Story should offer actions around graph/story structure, such as bridge card, alternate branch, ending, or stricter gate draft.
- Review should offer actions around diagnostics, such as explain/fix latest review and repair proposals.
- Actions should prefill the AI Assist panel mode, target card, and prompt where current APIs support it; they must not mutate cards directly.
- Preserve the draft/proposal/apply flow and existing undo validation.

## Acceptance Criteria

- [ ] Content, Story, and Review expose visible AI Assist action strips when the assist layer is enabled.
- [ ] Selecting an action opens the AI Assist panel with a scoped prompt and target context.
- [ ] Review repair action selects `repair_diagnostics` and preserves the requirement to run Review first.
- [ ] Actions do not call external providers or directly mutate content.
- [ ] `npm run verify` passes.

## Notes

- This task implements contextual routing and prefill only. A later backend task can make these actions call real models.
