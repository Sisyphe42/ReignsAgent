# Implementation

1. Stabilize CI triggers/actions and add a testing-only Electron no-sandbox command; run `npm run verify` and commit the CI fix.
2. Add the workspace package, pinned TOML dependency, schemas, atomic writer, project lifecycle, and unit tests; run `npm run verify` and commit.
3. Integrate workspace/config/project APIs into Creator Server and WebUI, including stored credential fallback and sample cloning; add integration/UI-oriented tests, run `npm run verify`, and commit.
4. Wire Electron, Node ZIP, and development data roots; extend packaged persistence smoke tests, runtime allowlists, docs, Node baseline, and task records; run all final gates and commit.

## Final validation

- `npm run verify`
- `npm run build:release`
- `npm run test:desktop`
- `npm run build:game -- fixtures/content/oss-court.cards.json <temporary-output-dir>`
- Build and smoke the native portable artifact available on the current host; native CI covers the other platforms.

## Rollback points

- CI-only commit is independently revertible.
- Workspace storage is introduced before server adoption so API integration can be reverted without removing the tested storage contract.
- Existing API request shapes remain accepted throughout migration.
