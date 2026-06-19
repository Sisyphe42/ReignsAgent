# ReignsAgent

ReignsAgent is a production-oriented, Reigns-like project for generating, testing, editing, previewing, and shipping card-based narrative experiences.

Phase 1 implements `@reigns-agent/core`: a pure runtime with factions, card scheduling, game-over checks, and low-level variable/tag hooks. Phase 2 adds `@reigns-agent/reviewer`: a headless Monte Carlo diagnostic engine and card graph analyzer. Phase 3 adds `@reigns-agent/pipeline`: local JSON/CSV exchange, connector boundaries, and reviewer-feedback prompts.

The repository intentionally contains no built-in upper-level progression systems, provider-specific SDK wiring, or production frontend yet.

## Commands

```sh
npm run verify
npm test
```
