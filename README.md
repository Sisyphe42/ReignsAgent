# ReignsAgent

ReignsAgent is a production-oriented, Reigns-like project for generating, testing, editing, previewing, and shipping card-based narrative experiences.

Phase 1 implements `@reigns-agent/core`: a pure runtime with factions, card scheduling, game-over checks, and low-level variable/tag hooks. Phase 2 adds `@reigns-agent/reviewer`: a headless Monte Carlo diagnostic engine and card graph analyzer. Phase 3 adds `@reigns-agent/pipeline`: local JSON/CSV exchange, connector boundaries, and reviewer-feedback prompts.

The repository intentionally contains no built-in upper-level progression systems, provider-specific SDK wiring, or production frontend yet.

The current Phase 1-3 baseline includes card contract validation, fixture verification, package export smoke tests, module boundary checks, Anti-RPG drift checks, unit tests, and integration tests.

## Commands

```sh
npm run verify
npm test
npm run content:validate -- fixtures/content/minimal.cards.json
npm run content:review -- fixtures/content/minimal.cards.json --cycles 100 --maxTurns 20
```
