# Image generation API implementation

1. Add Pipeline image contracts, capability descriptors, provider request builders/parsers, redaction, validation, and unit tests.
2. Add binary asset draft/commit/read/discard operations to filesystem Workspace and OPFS with contract tests.
3. Add Interface orchestration plus Creator Server and Browser backend routes, credential resolution, asset serving, and mock-provider integration tests.
4. Add image endpoint settings, capability-aware AI Assist controls, staging, basic mask/outpaint canvas, preview/apply/discard, Content entry points, and Hosted tests.
5. Update AI/workspace specs, README Mermaid architecture, ROADMAP, and regression expectations.
6. Run targeted tests, `npm run verify`, `npm run test:hosted`, fixture game build, visible local/Hosted smoke tests, then commit by phase and open a review PR.

## Rollback Points

- Provider adapters are isolated exports; text AI behavior remains unchanged.
- Image config defaults to absent and can be removed without migrating content.
- Draft bytes are disposable; committed files are immutable and referenced only through ordinary asset records.
