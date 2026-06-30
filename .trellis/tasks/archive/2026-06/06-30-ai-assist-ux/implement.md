# AI Assist UX and endpoint configuration implementation plan

## Phase A: Documentation and task setup

- Rename local branch to `feature/ai-assist-ux` and bind the Trellis task to that branch.
- Update README Creator dashboard section to replace "offline AI Edit" with AI Assist and custom endpoint language.
- Update ROADMAP with AI Assist direction, endpoint model, frontend UX next step, Review visualization direction, and non-goals.
- Update AGENTS with durable module-boundary and safety rules for AI Assist.

## Phase B: Frontend next-step implementation plan

- Rename the current dashboard panel label from `AI Edit` toward `AI Assist`.
- Replace Settings `provider`-only connector planning UI with endpoint fields: base URL, API key, protocol, model id, capability toggles, and test status.
- Add an `AI Assist` header toggle that controls contextual AI entry visibility and shows unconfigured/error/active status.
- Add Overview empty/sample initialization UI with a brief composer and safe project actions.
- Convert the current AI Edit panel into a shared AI action workspace/drawer pattern that Content, Story, and Review can open with scoped context.
- Add polished loading/progress states: inline loading for simple edits and progress timeline for longer draft generation.
- Add Dev Mode logs for recent AI calls after the UX shell is stable.

## Validation

- Run `npm run verify`.
- For visible frontend changes in the follow-up implementation phase, run the dashboard locally and smoke test Settings, Overview, Content, Story, Review, AI proposal preview/apply, and undo.
- For deployable-player safety, run `npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>` and confirm no AI/provider code is shipped.

## Rollback

- Documentation changes can be reverted independently.
- Frontend changes should keep the existing `/api/ai/edit/plan` and `/api/ai/edit/apply` flow usable until replacement UI is verified.
