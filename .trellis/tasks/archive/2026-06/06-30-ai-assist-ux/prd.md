# AI Assist UX and endpoint configuration

## Goal

Replace the current "offline AI Edit" framing with a creator-facing AI Assist direction that supports user-supplied LLM/image endpoints, context-aware editing actions, polished progress states, and safe draft/apply workflows without moving AI or provider logic into Core or the player runtime.

## Requirements

- Rename product language from "AI Edit/offline drafting" toward "AI Assist" where the docs describe the creator workflow.
- Document a lightweight Settings model: base URL, API key, API protocol (`completions`, `responses`, `messages`), model id, and capability checkboxes; image/vision endpoints may be separate only because their call shape differs.
- Avoid making multi-profile provider management a default user burden. Optional provider presets, model-list fetch, MCP, skills, and multi-profile developer tools are later enhancements, not the first UX requirement.
- Define AI mode as a visible assistance layer over Overview, Content, Story, and Review, not a separate chat-first product.
- Define Overview initialization for empty/sample projects with a brief composer and safe actions to start from blank, sample, import, or generated draft.
- Keep global regenerate/clear as destructive project actions behind Settings/project-menu warnings and confirmation.
- Define Review as the main AI-assisted narrative QA surface, with stronger visualization for coverage, endings, gauge pressure, issue cards, and AI repair proposals.
- Define contextual AI entry points for Content/Story/Review using a shared action popover or drawer with recommended actions, optional prompt injection, draft preview, and apply/undo behavior.
- Require visible polish for AI work: simple edit loading states, complex edit progress timelines, retry/error states, and Dev Mode call logs.
- Preserve project boundaries: Core remains UI-free and AI-free; generated output is validated through normal editor/player validation and draft/undo flows.

## Acceptance Criteria

- [ ] README describes AI Assist without saying "offline" for API-capable AI work.
- [ ] ROADMAP includes the AI Assist UX direction, Settings endpoint model, Review visualization direction, progress/error expectations, and frontend next step.
- [ ] AGENTS records durable AI Assist constraints for module boundaries, safety, and no provider logic in Core/player builds.
- [ ] Trellis design and implementation artifacts are complete enough for the frontend implementation phase.
- [ ] The branch is renamed to `feature/ai-assist-ux` and task metadata points to it.
- [ ] Documentation remains consistent with Anti-RPG and narrative progression boundaries.

## Notes

- This task documents and plans the UX direction first. It does not require implementing provider calls or real image generation.
- The current code already has `/api/ai/edit/plan` and `/api/ai/edit/apply` draft-plan behavior; later frontend work should evolve that surface rather than bypass it.
