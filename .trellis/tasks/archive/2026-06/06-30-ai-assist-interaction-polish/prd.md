# AI Assist interaction polish

## Goal

Make AI Assist feel like an integrated creator tool instead of a separate form by adding a unified contextual action surface, better prompt injection, polished loading states, retry/error affordances, and clearer progress for longer draft operations.

The user value is practical: non-technical content authors should understand what AI Assist is about to do, where the context came from, how to add their own instruction, and whether the operation is still working.

## Confirmed Facts

- This task stays on PR #18 / `feature/ai-assist-ux`.
- AI Assist already has a header toggle, Settings endpoint fields, an Overview starter, contextual Content/Story/Review action strips, and a central AI Assist panel.
- Current contextual actions route to the AI Assist panel and prefill mode, prompt, target card, and card count. They do not call providers or mutate content directly.
- Existing progress UI is panel-level and deterministic; it does not yet distinguish quick contextual edits from longer staged operations.
- Product direction in `ROADMAP.md` rejects chat-first AI as the default and calls for contextual entry points, optional prompt injection, visible progress stages, retryable errors, and Dev Mode logs later.
- Core/player must remain AI/provider/API-key free.

## Requirements

- Add a unified contextual AI Assist launcher pattern that can be reused from Content, Story, Review, and Overview without making each surface invent a different interaction model.
- Keep AI Assist contextual actions visible only when AI Assist is enabled, but make the enabled state visually obvious and intentional.
- Support prompt injection at the moment of action selection: creators should see the selected action, target context, recommended instruction, and an editable prompt before building the plan.
- Preserve the central AI Assist panel as the proposal preview/apply location; contextual surfaces may open a drawer/popover or preflight panel, but should not apply edits inline.
- Improve simple-operation loading with compact inline motion near the action that was triggered.
- Improve longer-operation progress with clear stages: context, request, model/local draft, parse, validate, proposal ready.
- Add user-facing error and retry affordances for draft building failures without exposing raw provider/request details in the normal UI.
- Keep raw logs, provider traces, and advanced diagnostics out of scope except for reserving a future Dev Mode location.
- Maintain accessible controls: buttons need clear labels/titles, disabled states need visible reasons, and keyboard focus should remain predictable.
- Avoid new backend provider behavior in this task.

## Acceptance Criteria

- [ ] Content, Story, Review, and Overview can invoke the same AI Assist preflight interaction model.
- [ ] The preflight interaction shows action name, target context, editable prompt, mode, and expected output before draft building starts.
- [ ] Quick contextual operations show a local loading/active state at the originating action surface.
- [ ] The AI Assist panel shows staged progress for longer operations with visually distinct active, completed, and failed states.
- [ ] Draft build errors show a readable message plus retry and edit-prompt paths.
- [ ] Contextual actions still do not call external providers directly or mutate content directly.
- [ ] No deployable player, Core, Reviewer, or Pipeline provider behavior changes are introduced.
- [ ] `npm run verify` passes.
- [ ] Visible frontend smoke confirms Content action, Story action, Review repair action, retry/error UI shape, and normal proposal apply path still work.

## Out of Scope

- Real provider execution.
- Chat-first UX.
- Multi-profile provider management.
- MCP/skills/tool-agent integration.
- Persistent call logs or Dev Mode implementation.
- New AI-generated asset binary upload/download/inspection.

## Notes

- Recommended scope: implement a preflight drawer/popover plus improved panel progress and retry states before adding real provider calls. This gives enough interaction evidence to judge whether the AI workflow feels coherent.
