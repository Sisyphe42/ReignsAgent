# Design

## Boundary and state

Development occurs in an isolated worktree and branch created at the recorded `baseRevision`. The selected checkout remains on its current branch with its pre-existing modifications. Only a target-relative unified diff is published to the workbench artifact path.

## Request trust flow

1. `createCreatorServer` creates a cryptographically random process capability.
2. `start()` records the actual listening Host values for the selected port and returns the capability to trusted in-process callers.
3. Before API dispatch or body parsing, the server validates the request Host and any supplied Origin. A single bootstrap route is exempt from the capability but remains Host/Origin guarded and uses no mutable state or secret-bearing response other than the capability.
4. Protected API requests must present the capability in a dedicated header using timing-safe comparison.
5. JSON-bearing non-GET/HEAD/DELETE requests must carry `application/json`; the existing binary image-stage route retains its explicit binary content type.

Browser clients lazily fetch the bootstrap route, cache the capability only in memory, and attach it to later API requests. Asset URLs that cannot set headers carry the capability in a bounded query parameter and are validated before asset access. Direct Node/Electron callers use the capability returned by `start()`.

## Credential binding

Credential fallback reads the persisted config projection and normalizes endpoint URLs. A stored text key is eligible only when the request's text endpoint equals the persisted text endpoint. Image fallback compares the request image endpoint against the persisted image endpoint, or against the persisted text endpoint when image credentials inherit text credentials. Explicit non-empty request credentials bypass fallback and preserve custom endpoint workflows.

## Compatibility

- Same-origin requests without an `Origin` header remain valid only with exact Host and capability, preserving trusted Node callers.
- Vite is restricted to loopback hostnames; its proxy targets the exact local backend Host and browser calls acquire the capability through the proxied bootstrap route.
- Hosted browser-only mode does not use `HttpCreatorBackend` and is unaffected.
- No capability is persisted in `localStorage`, workspace config, or build output.

## Rollback

The isolated worktree can be discarded without touching the selected checkout. The workbench artifact is immutable input for a later apply stage; this stage does not apply it.
