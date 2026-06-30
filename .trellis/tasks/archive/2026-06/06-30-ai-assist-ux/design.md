# AI Assist UX and endpoint configuration design

## Product Model

AI Assist is a context-aware creator assistance layer. It appears inside existing creator surfaces instead of becoming a chat-first product. Users should be able to configure a minimal AI connection, trigger scoped actions from the object they are editing, preview generated draft changes, and apply them through the existing editor validation and undo flow.

## Settings Model

- Default Settings exposes one text LLM connection and one optional image/vision connection.
- Text connection fields: base URL, API key, protocol (`completions`, `responses`, `messages`), model id, and capability checkboxes for vision, structured JSON, tool/function calling, reasoning/thinking, and streaming.
- Image/vision connection is separate only when the call shape requires it; do not force general multi-profile management on normal users.
- Provider presets and model-list fetch can be added later as conveniences. They must not be required for custom endpoints.
- Dev Mode may later expose multiple saved profiles, raw request/response logs, and advanced provider debugging.

## Creator Interaction Model

- Header exposes an `AI Assist` toggle with clear states: off, active, unconfigured, error.
- Overview handles initialization: empty/sample states show a brief composer plus actions to create blank, start from sample, import, or generate draft content.
- Content, Story, and Review expose contextual AI action buttons on selected cards, graph nodes/edges, issue cards, and relevant panels.
- All contextual actions open the same action popover/drawer shape: context summary, recommended action chips, optional prompt, generate draft, progress, proposal preview, apply.
- Prompt entry is always optional. The selected action supplies the default intent; the prompt refines it.
- Global regenerate and clear live in project settings or project menu with destructive styling and confirmation.

## Draft, Progress, and Safety

- AI output should be represented as draft proposals with explicit patch operations. Do not directly mutate project content from an AI response.
- Simple actions show inline loading/skeleton states near the edited object.
- Complex actions show a progress timeline: collect context, build request, wait for model, parse draft, validate, ready to apply.
- Errors show a user-facing message and retry action in context; detailed request/response data belongs in Dev Mode.
- Applied patches must go through existing editor validation, player validation where relevant, and undo/history.
- API keys must not enter deployable player builds.

## Module Boundaries

- Core remains headless and AI-free.
- Pipeline owns AI request contracts, connector boundaries, and patch/proposal shaping.
- Interface owns creator orchestration, editor validation, and API projection.
- Creator-web owns visual UX, contextual actions, progress states, and preview/apply controls.
