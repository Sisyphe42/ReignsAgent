# ReignsAgent

<p align="center">
  <img src="apps/creator-web/public/logo-alpha.png" alt="ReignsAgent logo" width="128" />
</p>

<p align="center">
  <img alt="Node.js v22+" src="https://img.shields.io/badge/Node.js-v22%2B-339933?logo=node.js&logoColor=white" />
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-blue" />
</p>

<p align="center">
  English | <a href="README_zh-CN.md">简体中文</a>
</p>

ReignsAgent is a modular authoring, validation, and publishing stack for [Reigns](https://www.devolverdigital.com/games/reigns)-like card narratives. It combines a creator workbench, a deterministic headless runtime, simulation-based diagnostics, content import/export tooling, and a deployable player build path.

The project is built for two primary audiences: creators who need a practical workspace for narrative card production, and AI-assisted workflows that need clear contracts for drafting, repairing, validating, and shipping content without crossing runtime boundaries.

## Contents

- [Capabilities](#capabilities)
- [Design Boundaries](#design-boundaries)
- [Quick Start](#quick-start)
- [Creator Workflow](#creator-workflow)
- [Architecture](#architecture)
- [Content Model](#content-model)
- [AI-Assisted Workflows](#ai-assisted-workflows)
- [Build Output](#build-output)
- [Package Examples](#package-examples)
- [Repository Layout](#repository-layout)
- [CI And Verification](#ci-and-verification)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Capabilities

| Area | Scope |
| --- | --- |
| Creator workbench | Import, edit, review, preview, configure AI Assist, and prepare builds from a single browser workspace. |
| Core runtime | Deterministic headless play sessions with four default gauges, card scheduling, choices, game-over detection, snapshots, restore, and event logs. |
| Reviewer | Monte Carlo simulation, graph reachability, coverage diagnostics, pacing checks, endings analysis, and balance warnings. |
| Pipeline | JSON/CSV/content-bundle exchange, generation request contracts, endpoint protocol handling, patch prevalidation, and reviewer feedback actions. |
| Deployable player | Standalone player assets built from validated content and core runtime code only. |
| AI Assist | User-supplied endpoint workflow for draft proposals, review repair, story edits, and visual request previews. |

## Design Boundaries

ReignsAgent keeps the player model deliberately small: one active card, two choices, four default gauges, and pure left/right interaction. Narrative progression is expressed through author-owned data such as tags, variables, card requirements, metadata, story groups, arcs, endings, i18n, and presentation configuration.

The product does not ship built-in equipment, pets, inventory, shops, rarity, crafting, classes, skill trees, loot, or resource-management systems. Those concepts can appear as story text or user-defined labels in content, but they are not built-in gameplay loops or product features.

AI Assist is creator-side tooling. Deployable player builds do not include provider SDKs, API keys, network AI calls, generated-edit tooling, or AI-specific gameplay behavior.

## Quick Start

Install dependencies and run the full verification gate:

```sh
npm install
npm run verify
```

Start the local creator stack:

```sh
npm run dev:interface
npm run dev:dashboard
```

Open the local surfaces:

| Surface | URL |
| --- | --- |
| Creator Workbench | `http://127.0.0.1:5173/workbench` |
| Preview Player | `http://127.0.0.1:5173/play` |
| Local API | `http://localhost:4321/api/editor` |

Common project commands:

```sh
npm test
npm run build:dashboard
npm run dev:hosted
npm run build:hosted
npm run build:game -- fixtures/content/oss-court.cards.json dist/player
npm run build:release
npm run test:desktop
npm run test:desktop:packaged
npm run build:desktop
npm run content:validate -- fixtures/content/minimal.cards.json
npm run content:review -- fixtures/content/minimal.cards.json --cycles 100 --maxTurns 20
npm run content:convert -- fixtures/content/minimal.cards.json tmp.cards.csv
npm run content:feedback -- review-report.json
```

## Creator Workflow

The main authoring UI lives in `apps/creator-web`.

| Workspace area | Purpose |
| --- | --- |
| Overview | Project health, card count, validation state, player readiness, review status, and build status. |
| Content | Content-bundle import, card editing, left/right choice tuning, gauge effects, tags, variables, and art bindings. |
| Story | Reachability, left/right transitions, story groups, endings, graph issues, and reviewer heat. |
| Review | Narrative QA for balance, pacing, coverage, unreachable paths, endings, and story group health. |
| AI Assist | User endpoint configuration plus reviewable draft, repair, story, and visual proposals. |
| Preview | Local Reigns-style play sessions using keyboard, pointer drag, touch, or buttons. |
| Build | Deployable `.game.json` and player asset preparation. |
| Settings | Creator skin, endpoint protocol, model id, capability flags, and route compatibility. |

Workbench URLs preserve panel state, for example `/workbench/content`. Skin state is shared through query parameters such as `?skin=github-light`, `?skin=catppuccin-latte`, and `?skin=classic`; preview player pages accept the same `skin` query.

## Architecture

```mermaid
flowchart LR
  creator["Creator Web<br/>authoring, preview, AI Assist"]
  api["Local Creator API<br/>/api/*"]
  interface["Interface<br/>workflow orchestration"]
  pipeline["Pipeline<br/>content exchange and AI contracts"]
  reviewer["Reviewer<br/>simulation diagnostics"]
  core["Core<br/>headless runtime"]
  player["Deployable Player<br/>core-only runtime"]
  provider["User AI Endpoint"]

  browserBackend["Hosted browser backend<br/>OPFS + Web Worker"]
  creator --> api
  creator --> browserBackend
  api --> interface
  interface --> core
  interface --> reviewer
  interface --> pipeline
  pipeline -->|"transient request"| provider
  reviewer -->|"JSON diagnostics"| interface
  pipeline -->|"validated proposals"| interface
  core --> player
```

The Creator UI has two host adapters. Local Web, Node ZIP, and Electron use `HttpCreatorBackend` over the shared Creator Server. The hosted PWA uses `BrowserCreatorBackend`, stores equivalent documents in OPFS, runs diagnostics in a Web Worker, and calls user AI endpoints directly. Neither adapter changes Core, content, proposal, or player contracts.

| Layer | Responsibility |
| --- | --- |
| `packages/core` | Headless deterministic runtime. No UI, IO, AI, reviewer, pipeline, or deployment code. |
| `packages/reviewer` | Simulation, graph diagnostics, narrative coverage, endings analysis, and balance reporting. |
| `packages/pipeline` | Content exchange, AI request contracts, endpoint normalization, patch prevalidation, and feedback actions. |
| `packages/interface` | Creator workflow orchestration, local web surfaces, play-session helpers, diagnostics projection, and build assembly. |
| `apps/creator-web` | Vite/React creator workspace. |

## Content Model

Cards and metadata are the product contract.

| Field | Role |
| --- | --- |
| `requirements.tags` | Gate cards on acquired or missing tags. |
| `requirements.variables` | Gate cards on exact variable values. |
| `requirements.factions` | Gate cards on `gauge0`, `gauge1`, `gauge2`, and `gauge3` with `min`, `max`, or `equals`. |
| `choices[].effects.tags` | Set or clear tags after a choice. |
| `choices[].effects.variables` | Change low-level variable state after a choice. |
| `choices[].effects.factions` | Change the default four gauges. |
| `metadata.story.groups` | Describe chapters, themes, arcs, endings, or other authoring groups. |
| `metadata.presentation.gauges` | Rename, describe, or hide the default gauge displays. |
| `metadata.i18n` and card-level `i18n` | Provide localized card text and choice labels. |

Legacy `faith`, `people`, `military`, and `treasury` keys are accepted on import and normalized to neutral `gauge0` through `gauge3` slots.

## AI-Assisted Workflows

ReignsAgent is designed to work with AI systems as controlled collaborators. AI output should be explicit, reviewable, and validated before it becomes authored content.

For content generation or repair:

- Keep playable cards binary: exactly one left choice and one right choice.
- Use tags, variables, requirements, story groups, and endings for progression.
- Use only the default four gauge slots for built-in balance.
- Return proposals or patches that can be reviewed and applied deliberately.

For code changes:

- Keep core runtime changes headless and deterministic.
- Keep endpoint calls and prompt/proposal handling in creator-side workflows.
- Keep deployable player output free of credentials, provider SDKs, network AI calls, and editor-only tooling.
- Run `npm run verify` before considering changes ready.

### Endpoint Proposal Flow

```mermaid
sequenceDiagram
  participant UI as Creator Web
  participant API as Local API
  participant Interface as Interface
  participant Pipeline as Pipeline
  participant Provider as User Endpoint
  participant Core as Core

  UI->>API: draft / repair / analyze request
  API->>Interface: current editor snapshot
  Interface->>Pipeline: redacted context + endpoint config
  Pipeline->>Provider: transient request
  Provider-->>Pipeline: proposal JSON
  Pipeline-->>Interface: prevalidated patches
  Interface-->>API: immutable plan
  API-->>UI: proposal preview
  UI->>API: apply selected proposal
  API->>Interface: baseFingerprint guard
  Interface->>Core: validate resulting cards
```

## Build Output

Build a deployable player from a content bundle:

```sh
npm run build:game -- fixtures/content/oss-court.cards.json dist/player
```

The build emits:

| Output | Description |
| --- | --- |
| `*.game.json` | Deployable content bundle. |
| `player.html` | Standalone player page. |
| `player-runtime.js` | Player runtime with stitched core logic. |
| `assets/logo-alpha.png` | Transparent product logo. |
| Local content assets | Assets referenced by the bundle, such as `assets/sample/*.svg`. |

## Creator Distribution

### Hosted PWA

Run the Creator without the local API:

```sh
npm run dev:hosted
npm run build:hosted
```

The output is `apps/creator-web/dist-hosted/`. Set `REIGNS_AGENT_BASE_PATH=/reignsagent/` when building for a reverse-proxy or static-host subpath; application URLs, manifest scope, Service Worker, and offline navigation use that prefix.

Hosted projects and `config.toml` live in origin-scoped OPFS. Chrome and Edge are the supported v1 browsers. After the first successful load the PWA can reopen offline. Clearing site data destroys the workspace, and changing scheme, host, or port selects a different workspace, so Settings exposes persistence status plus Workspace ZIP and active-project ZIP export/import. Backups exclude the plaintext AI key by default; including it requires an explicit checkbox and confirmation.

AI calls go directly to the configured endpoint. An HTTPS Creator requires an HTTPS endpoint, except localhost, and the endpoint must allow the Creator origin plus `Authorization` and `Content-Type` through CORS. ReignsAgent operates no relay. Browser player export downloads a locally assembled ZIP and excludes AI settings and credentials.

Server-side `.env` or process-environment credential loading belongs only to the local Creator Server and self-hosted server deployments. A hosted static build cannot read a private server `.env`; never expose secrets through `VITE_*` variables because those values are compiled into public browser assets. Each hosted user supplies their own endpoint and key in the browser workspace.

### Local Node ZIP

Build the complete local Creator distribution:

```sh
npm run build:release
```

This command runs the full verification gate, compiles the Creator, and emits both `dist/reigns-agent-<version>/` and `dist/reigns-agent-<version>.zip`. The ZIP is cross-platform and requires Node.js 22 or newer on the target machine; it does not bundle Node.js or `node_modules`.

After extracting the ZIP, start the Creator with one of these commands:

```sh
# All platforms
node start.mjs

# Windows convenience launcher
start.cmd

# macOS/Linux convenience launcher
sh start.sh
```

The launcher serves the compiled Creator, local API, and player preview from one process at `http://127.0.0.1:4321/workbench`, then opens the browser. Use `--no-open` to suppress browser launch, or set `HOST` and `PORT` to override the listener.

The distribution contains:

| Path | Purpose |
| --- | --- |
| `creator/` | Compiled Vite/React Creator application. |
| `apps/creator-server` | Shared local API and static application server used by CLI and packaged hosts. |
| `scripts/build-game.mjs` | Deployable standalone player builder. |
| `packages/*/src` | Runtime modules required by the local API and player builder. |
| `packages/interface/web` | Player preview and standalone player templates. |
| `fixtures/content` | Example content for evaluation and player builds. |

The package intentionally excludes tests, frontend source, caches, `.env`, `node_modules`, and AI-specific player behavior. Creator state is stored beside the extracted package under `ReignsAgentData`; set `REIGNS_AGENT_DATA_ROOT` to override that location. To generate a player site from the extracted package, run:

```sh
node scripts/build-game.mjs fixtures/content/oss-court.cards.json output/player
```

## Electron Desktop Host

Electron is an optional outer host over the same compiled Creator and local API used by the Node ZIP. The WebUI, API routes, Core, Pipeline, Reviewer, Interface, Workspace, and player builder remain shared; no product logic is implemented in Electron.

```sh
# Build Creator, stage the shared runtime, and launch Electron
npm run dev:desktop

# Run boundary tests plus a real utility-process/API smoke test
npm run test:desktop

# Run the full repository gate and make the current platform's portable ZIP
npm run build:desktop
```

The desktop app, window, executable, and metadata all use the product name `ReignsAgent`; package author metadata is `Sisyphe42`, matching the GitHub repository owner. It uses application ID `io.reignsagent.app`, starts the Creator Server in an Electron utility process on a random loopback port, and loads `/workbench` in a sandboxed BrowserWindow. The host marks that shared route as a desktop client so the Creator can enable desktop-only panel shortcuts (`Ctrl+Tab`, `Ctrl+Shift+Tab`, and `Ctrl+1` through `Ctrl+8`) without importing Electron APIs.

Creator navigation can be pinned open on wide layouts or reduced to an icon rail that temporarily reveals the full tab bar on hover and keyboard focus; narrow layouts keep the complete horizontal tab strip. The pin preference is local to each client. Interface language defaults to following the current browser or device, with explicit English and Simplified Chinese overrides stored in the shared workspace config so browser, local server, and desktop clients consume the same preference.

All desktop targets are portable ZIP archives: Windows x64, macOS x64/arm64, and Linux x64. Extract the archive and run `ReignsAgent` directly; no installer or system Node.js is required. Electron profile data, `config.toml`, projects, and game exports stay beside the extracted app under `ReignsAgentData/`. On macOS, that directory is created beside `ReignsAgent.app`. Moving the app and its data together preserves the portable workspace.

The durable workspace layout is shared by Electron and the Node ZIP:

```text
ReignsAgentData/
  config.toml
  projects/<project-id>/
    project.toml
    content.json
    workspace.toml
    assets/
    reviews/
    builds/
  Builds/
```

`content.json.metadata.title` is the canonical project name. The bundled sample is immutable; choosing **Sample** clones it into an ordinary project. Global theme and AI endpoint settings live in `config.toml`; project-local panel/selection state lives in `workspace.toml`. API keys are stored as plaintext in the local config by product choice, masked in the UI, and excluded from project/player exports and logs.

`.github/workflows/desktop.yml` builds portable archives only for manual runs and `v*` tags, then uploads workflow artifacts without publishing a release. The archives are unsigned and may still trigger SmartScreen or Gatekeeper warnings.

`test:desktop:packaged` runs after Forge packaging and verifies both the unpacked Creator Server runtime and the packaged executable handshake. `verify-desktop-artifacts` rejects installer formats and requires a ZIP on every platform. Builders with an existing Electron ZIP may set `ELECTRON_ZIP_DIR` to its containing directory to avoid downloading the runtime again.

Electron v1 intentionally has no preload bridge, native file dialogs, automatic updates, signing, notarization, store publishing, or database. Its persistence is the shared file workspace rather than an Electron-only store.

## Package Examples

### Core Runtime

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

### Reviewer

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

### Pipeline

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

### Interface

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

## Repository Layout

| Path | Purpose |
| --- | --- |
| `apps/creator-web` | Creator dashboard with HTTP and hosted OPFS backend adapters. |
| `packages/core` | Headless game runtime. |
| `packages/reviewer` | Simulation and diagnostic engine. |
| `packages/pipeline` | Content exchange and AI proposal contracts. |
| `packages/interface` | Creator orchestration and player build assembly. |
| `packages/workspace` | Host-neutral TOML/project contracts plus Node filesystem and browser OPFS adapters. |
| `scripts` | Dev server, content CLI, build-game assembler, and verification gates. |
| `fixtures` | Sample and validation content. |
| `test` | Cross-package integration tests. |

## CI And Verification

The repository uses GitHub Actions for pull requests and `master` pushes, with duplicate runs cancelled per ref. CI runs `npm ci` and `npm run verify` on Node.js 22 and 24, then performs hosted-PWA/subpath, deployable-player, and Electron source smoke tests on Node.js 22. The Hosted job declares `needs: verify`, so every browser smoke run is gated by the shared Pipeline, Interface, Creator Server, endpoint-protocol, and integration tests rather than duplicating them inside the browser job. Native desktop artifacts remain manual or `v*` tag builds.

### Local Verification

Run the same broad gate used by CI before treating a change as ready:

```sh
npm run verify
```

`npm run verify` includes:

| Stage | Command | Purpose |
| --- | --- | --- |
| Syntax check | `node scripts/check-syntax.mjs` | Parse implementation JavaScript files before deeper checks. |
| Export check | `node scripts/verify-exports.mjs` | Confirm workspace package export surfaces stay valid. |
| Boundary check | `node scripts/verify-boundaries.mjs` | Keep package responsibilities separated. |
| Anti-RPG drift check | `node scripts/verify-anti-rpg.mjs` | Guard the product boundary around pure card-swipe gameplay. |
| Fixture verification | `node scripts/verify-fixtures.mjs` | Validate sample content and deployable-player fixture assumptions. |
| Dashboard build | `npm run build:dashboard` | Compile the Vite/React creator workspace. |
| Unit tests | `npm run test:unit` | Run package-level Node test suites. |
| Integration tests | `npm run test:integration` | Run cross-package integration flows. |

### Focused Commands

Use focused commands while iterating, then run the full gate before commit:

```sh
npm run build
npm run test:unit
npm run test:integration
npm run content:validate -- fixtures/content/minimal.cards.json
npm run content:review -- fixtures/content/minimal.cards.json --cycles 100 --maxTurns 20
```

### Deployable Player Smoke Build

For deployable player changes, template changes, content bundle changes, or static player asset changes, also run:

```sh
npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>
```

Confirm the output includes `player.html`, `player-runtime.js`, a `*.game.json` content bundle, `assets/logo-alpha.png`, and any local sample assets referenced by the bundle.

### Frontend Smoke Testing

For visible creator or player changes:

1. Start `npm run dev:interface`.
2. Start `npm run dev:dashboard`.
3. Open `/workbench` and `/play?skin=<skin>`.
4. Confirm the expected panel state, skin query behavior, `document.documentElement.dataset.skin`, and visible layout at desktop and mobile widths.

## Acknowledgements

ReignsAgent is partly inspired by [Reigns](https://www.devolverdigital.com/games/reigns)' use of numerical balance as gameplay.

ReignsAgent is independent and unaffiliated with Reigns, Nerial, or Devolver Digital.

## License

ReignsAgent is released under the [MIT License](LICENSE).
