# Browser-first hosted Creator

## Goal

Provide a publicly reachable, browser-first ReignsAgent Creator that one maintainer can host cheaply while each visitor's projects and configuration remain on that visitor's device. Preserve the portable desktop and local Creator Server as alternative hosts over shared domain logic.

## Background

- The current Core and Reviewer implementations are largely pure JavaScript and can execute in a browser or Web Worker.
- The current Creator Server and build scripts depend on Node HTTP and filesystem APIs; these host adapters cannot run in a browser unchanged.
- Browser OPFS is origin-scoped, quota-bound, invisible as a normal user directory, and deleted when site storage is cleared.
- Direct browser calls to user-supplied AI endpoints require those endpoints to allow the deployed Creator origin through CORS.

## Requirements

- Deploy the Creator frontend as static HTTPS assets with no mandatory per-user server session.
- Persist app configuration and multiple projects in browser-owned storage, using OPFS as the primary project filesystem and a small metadata index where useful.
- Keep browser data isolated per origin and provide explicit project/workspace export and import for backup and migration.
- Run deterministic game logic and normal review workloads client-side; move expensive review/build work off the main UI thread.
- Generate deployable player ZIPs in the browser and download them without relying on server-side filesystem access.
- Support AI only through user-supplied endpoints that permit browser CORS in v1; do not provide or operate a relay.
- Keep shared domain services independent of Node, browser, and Electron. Implement filesystem, configuration, HTTP, and browser persistence as host adapters.
- Keep local Creator Server and Electron portable releases supported; they use real `config.toml` and project directories, while the hosted Creator stores equivalent logical documents inside browser storage.

## Out of Scope

- Compiling the Node Creator Server wholesale to WebAssembly.
- Server-side project storage, user accounts, synchronization, or collaborative editing in the first browser-hosted release.
- An unrestricted public AI proxy paid for or trusted by the maintainer.

## Acceptance Criteria

- [x] A visitor can create, rename, close, reopen, export, and import multiple projects after refreshing the hosted site.
- [x] Theme, endpoint settings, and other app configuration persist for the same browser origin.
- [x] Core preview, content validation, and a bounded Reviewer run work with the network disabled after initial app load.
- [x] A deployable player ZIP can be generated and downloaded entirely in the browser.
- [x] Browser AI direct mode clearly detects and reports CORS-incompatible endpoints without sending project data through the maintainer's server.
- [x] Clearing site data is documented as destructive and exported project bundles restore into desktop/local/browser hosts.
- [x] Browser, local server, CLI, and Electron adapters pass shared content and build conformance fixtures.

## Technical Notes

- WebAssembly may later optimize a genuinely CPU-bound component, but it does not provide Node filesystem or HTTP-server semantics by itself and is not required for the current JavaScript domain modules.
- A browser-hosted `config.toml` may be stored as TOML text inside OPFS for schema parity, but it is not a normal user-visible file until exported.
