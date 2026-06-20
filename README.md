# ReignsAgent

ReignsAgent is a production-oriented, Reigns-like project for generating, testing, editing, previewing, and shipping card-based narrative experiences.

Phase 1 implements `@reigns-agent/core`: a pure runtime with factions, card scheduling, game-over checks, low-level variable/tag hooks, JSON-safe snapshots, restore, deterministic steps, and event logs. Phase 2 adds `@reigns-agent/reviewer`: a headless Monte Carlo diagnostic engine, single-cycle simulator, event samples, coverage metrics, configurable warning thresholds, and card graph analyzer. Phase 3 adds `@reigns-agent/pipeline`: local JSON/CSV/content-bundle exchange, stable connector request contracts, reviewer-feedback action plans, and local content workflow commands.

The repository intentionally contains no built-in upper-level progression systems, provider-specific SDK wiring, or production frontend yet.

The current Phase 1-3 baseline includes card contract validation, fixture verification, package export smoke tests, module boundary checks, Anti-RPG drift checks, unit tests, and integration tests.

## Commands

```sh
npm run verify
npm test
npm run content:validate -- fixtures/content/minimal.cards.json
npm run content:review -- fixtures/content/minimal.cards.json --cycles 100 --maxTurns 20
npm run content:convert -- fixtures/content/minimal.cards.json tmp.cards.csv
npm run content:feedback -- review-report.json
```

## Core Runtime Example

```js
import { createRuntime, restoreState } from "@reigns-agent/core";

const runtime = createRuntime({ cards, rng: () => 0 });
const result = runtime.step("accept");
const snapshot = runtime.snapshot();

const restored = createRuntime({
  cards,
  state: restoreState(snapshot),
  rng: () => 0
});

console.log(result.event, restored.events);
```

## Reviewer Example

```js
import { runMonteCarloReview, runSimulationCycle } from "@reigns-agent/reviewer";

const cycle = runSimulationCycle({
  cards,
  seed: 7,
  maxTurns: 20,
  includeEvents: true
});

const report = runMonteCarloReview({
  cards,
  cycles: 1000,
  maxTurns: 50,
  sampleLimit: 3,
  thresholds: { dominantGameOverRate: 0.45 }
});

console.log(cycle.terminalReason, report.diagnostics.warnings);
```

## Pipeline Example

```js
import {
  buildCardGenerationRequest,
  createDiagnosticFeedback,
  parseContentJson,
  stringifyContentJson
} from "@reigns-agent/pipeline";

const bundle = parseContentJson(sourceText);
const request = buildCardGenerationRequest({
  theme: bundle.metadata.title ?? "untitled",
  count: 8,
  diagnostics: reviewerReport
});
const feedback = createDiagnosticFeedback(reviewerReport);

console.log(request.requestId, feedback.actions, stringifyContentJson(bundle));
```
