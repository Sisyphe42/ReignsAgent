# Image generation API

## Goal

Replace AI Assist's visual request preview with a real, reviewable creator workflow for generating, editing, inpainting, and outpainting card art through creator-configured image endpoints.

## Requirements

- Support OpenAI Images-compatible, Gemini Interactions, and Stability Stable Image request/response families through one capability-driven Pipeline contract.
- Keep image calls, credentials, drafts, and binary persistence in Creator/Pipeline/Workspace. Core, Reviewer, and deployable players remain AI-free.
- Accept project assets and uploaded PNG/JPEG/WebP references, optional masks, and provider-supported generation parameters; localize every accepted result below the active project's `assets/generated` directory.
- Provide Node filesystem and Hosted OPFS implementations with safe paths, a 50 MiB aggregate request ceiling, content-addressed final names, and disposable drafts.
- Require explicit creator acceptance before writing asset metadata or binding output to a card. Never overwrite an existing image in place.
- Add endpoint configuration, capability-aware operation controls, basic mask/outpaint canvas controls, preview comparison, selection, apply, discard, cancellation, and Content-panel entry points.
- Keep existing text AI contracts compatible; map legacy `generate_asset` entry points to the new generate workflow and retain `analyze_asset` behavior.
- Update the AI contract, README architecture, and roadmap.

## Acceptance Criteria

- [x] All four operations produce staged previews through every adapter that declares the operation, and unsupported combinations fail before network execution.
- [x] Provider JSON, multipart, base64, URL, and binary shapes normalize to one redacted draft result.
- [x] Applying a selected output atomically persists a content-addressed image plus `upsertAsset`; discarding removes draft bytes and failed requests do not mutate content.
- [x] Local and Hosted creators can display project-generated assets without embedding base64 in `content.json`.
- [x] Image endpoint credentials never appear in API responses, content bundles, logs, project exports, or player builds.
- [x] UI exposes only supported parameters and preserves inputs after failure or cancellation.
- [x] Pipeline, Workspace, server integration, Hosted browser, and deployable-player regressions pass.
- [x] `npm run verify`, `npm run test:hosted`, and a fixture `npm run build:game` pass.

## Out of Scope

- Arbitrary request templates or scripts, video, batch jobs, streaming partial images, persistent queues, automatic model discovery, and a full layered image editor.
