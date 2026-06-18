# ReignsAgent

ReignsAgent is a modular, headless-first project for Reigns-like card simulation and content review.

Phase 1 implements `@reigns-agent/core`: a pure runtime with factions, card scheduling, game-over checks, and abstract inventory/tag hooks. Phase 2 adds `@reigns-agent/reviewer`: a headless Monte Carlo diagnostic engine and card graph analyzer. Phase 3 adds `@reigns-agent/pipeline`: local JSON/CSV exchange, connector boundaries, and reviewer-feedback prompts.

The repository intentionally contains no inventory UI, shops, provider-specific SDK wiring, or local ingestion dashboard code yet.

## Commands

```sh
npm test
```
