# ReignsAgent

ReignsAgent is a production-oriented, Reigns-like project for generating, testing, editing, previewing, and shipping card-based narrative experiences.

Phase 1 implements `@reigns-agent/core`: a pure runtime with factions, card scheduling, game-over checks, low-level variable/tag hooks, JSON-safe snapshots, restore, deterministic steps, and event logs. Phase 2 adds `@reigns-agent/reviewer`: a headless Monte Carlo diagnostic engine, single-cycle simulator, event samples, coverage metrics, configurable warning thresholds, and card graph analyzer. Phase 3 adds `@reigns-agent/pipeline`: local JSON/CSV/content-bundle exchange, stable connector request contracts, reviewer-feedback action plans, and local content workflow commands. Phase 4 adds `@reigns-agent/interface`: creator orchestration, player-card validation, local dashboard/player preview APIs, diagnostics projection, connector request preview, and deployable player build assembly.

The repository intentionally contains no built-in upper-level progression systems or provider-specific SDK wiring. The interface package coordinates the existing modules without moving game rules, generation logic, or reviewer simulation into the frontend layer.

The current baseline includes card contract validation, player-card validation, fixture verification, package export smoke tests, module boundary checks, Anti-RPG drift checks, deployable player smoke tests, unit tests, and integration tests. `fixtures/content/oss-court.cards.json` is a complete local sample deck with CC BY 3.0 SVG art assets from Game-icons.net, `en`/`zh-Hans` i18n metadata, and policy-gated presentation customization.

## Commands

```sh
npm run verify
npm test
npm run dev:interface
npm run dev:dashboard
npm run build:dashboard
npm run build:game -- fixtures/content/oss-court.cards.json dist/player
npm run content:validate -- fixtures/content/minimal.cards.json
npm run content:review -- fixtures/content/minimal.cards.json --cycles 100 --maxTurns 20
npm run content:convert -- fixtures/content/minimal.cards.json tmp.cards.csv
npm run content:feedback -- review-report.json
```

## Creator dashboard

`npm run dev:dashboard` starts the Vite/React creator workspace (default `http://127.0.0.1:5173`) and proxies API/assets to `npm run dev:interface`. Start both commands during dashboard development. `npm run dev:interface` starts the local API/static server (default `http://localhost:4321`) and serves the built React dashboard at `/` when `npm run build:dashboard` has produced `apps/creator-web/dist`; the legacy dashboard remains available at `/classic`, and player preview remains at `/play`.

- **Ingest** — import a local `.cards.json` / content bundle or paste JSON; the Open Court sample deck loads with one click.
- **Edit** — full structured card/choice editor: card text, per-choice labels, faction deltas (faith/people/military/treasury), tag and variable key/value rows, and an advanced JSON escape hatch. Edits preserve input focus and patch through granular routes. A live `player-ready`/`invalid` badge per card reflects server validation.
- **Preview** — Reigns-style swipe over the headless core via keyboard (← → / A D), pointer drag, touch, or buttons. The end-of-run summary shows turns survived and the losing faction; "Play again" restarts.
- **Diagnose** — run the reviewer headlessly; clickable warnings jump to the referenced card row.
- **Build** — assemble and export a self-contained deployable `.game.json`.

The left workflow rail (Ingest → Edit → Preview → Diagnose → Build) reports per-step status. In-progress editor work is saved to `localStorage` and offered for restore on reload (server-validated through `/api/editor/restore`); the deployable player itself stays stateless.

`npm run build:game -- <bundle.json> <out.dir>` stitches a deployable player (`player.html` + `player-runtime.js`) that imports only the headless core — no pipeline, reviewer, or dashboard code ships to players.

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

## Interface Example

```js
import {
  createCardEditor,
  createPlaySession,
  prepareGameBuild,
  runDiagnostics
} from "@reigns-agent/interface";

const editor = createCardEditor({ cards, metadata: { title: "Small Court" } });
const diagnostics = runDiagnostics({ cards: editor.toCards(), cycles: 1000, maxTurns: 50 });
const session = createPlaySession({ cards: editor.toCards(), rng: () => 0 });

session.start();
session.swipe("left");

const build = prepareGameBuild({ editor, buildId: "small-court-preview" });

console.log(diagnostics.healthScore, session.factions, build.player.choiceModel);
```

## Presentation And i18n

Content may define `metadata.presentation.css.variables` for theme-level CSS custom properties. Raw CSS, HTML, and JS slots are normalized and exported for trusted hosts, but built-in players only apply raw CSS when `metadata.presentation.policy.allowCssText` is true and never execute HTML/JS by default.

Content may define `metadata.i18n` plus per-card `i18n` entries. `createPlaySession({ locale })` and deployable `createPlayer(build, { locale })` resolve locale fallback and return localized card text and choice labels.
