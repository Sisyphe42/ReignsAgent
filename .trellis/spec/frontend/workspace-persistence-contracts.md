# Creator Workspace Persistence Contracts

## Scenario: Shared local workspace across Creator hosts

### 1. Scope / Trigger

- Trigger: changes to Creator configuration, project lifecycle, editor mutation routes, host data roots, or runtime staging.
- Scope: local Web, Node ZIP, and Electron use one Creator Server and one filesystem Workspace adapter. Hosted Web uses the OPFS adapter over the same host-neutral schema and projections; it is selected explicitly at build time, never as a runtime fallback.

### 2. Signatures

- `createWorkspaceStore({ dataRoot, initialBundle? })`
- `createCreatorServer({ dataRoot?, defaultBuildOutputDir?, ... })`
- `GET/PATCH /api/config`
- `GET/PATCH /api/workspace`
- `GET/POST /api/projects`
- `POST /api/projects/:id/open`
- `PATCH/DELETE /api/projects/:id`

### 3. Contracts

- Disk layout: `config.toml`, `projects/<uuid>/{project.toml,content.json,workspace.toml,assets,reviews,builds}`, and top-level `Builds`.
- `content.json.metadata.title` is the only project-title source. Manifests own ID, schema, timestamps, source, and content path.
- API config reads expose `hasApiKey`, never the plaintext key. `PATCH /api/config` may replace the key or clear it with `clearApiKey: true`.
- AI request credentials take precedence over the stored key; the stored key fills only a missing/blank request credential.
- Every successful editor mutation persists the complete active bundle through the Workspace write queue.
- Environment roots: `REIGNS_AGENT_DATA_ROOT` overrides Node/local data; Electron always passes its beside-app `ReignsAgentData` path to the utility process.
- New runtime modules must be registered once in `CREATOR_RUNTIME_ENTRIES`, which feeds both Node ZIP and Electron staging.

### 4. Validation & Error Matrix

- Missing data root -> `WorkspaceError` with `data_root_required`.
- Invalid TOML -> path-specific `toml_parse_failed`; source file remains unchanged.
- Unsupported config/project/workspace schema -> corresponding `*_schema_unsupported` error.
- Invalid project ID/path -> `project_id_invalid`; never resolve an arbitrary filesystem path.
- Failed editor mutation -> do not enqueue or write a replacement bundle.
- Delete active project -> select the newest remaining project; deleting the last project creates a blank project.

### 5. Good/Base/Bad Cases

- Good: rename a project, restart on another random port, and restore the same title because disk state is authoritative.
- Base: choose Sample, clone the immutable fixture into a normal project, then edit it independently.
- Bad: persist theme, endpoint metadata, project content, or API keys only in `localStorage`; Electron random-port origins make that state unstable.
- Bad: import a new package from Creator Server without adding it to the shared runtime allowlist; source tests pass but extracted releases fail at module resolution.

### 6. Tests Required

- Workspace unit tests assert TOML defaults/round-trip, project isolation, atomic serialized writes, malformed-file preservation, and API-key redaction.
- Creator Server integration tests restart over one data root and assert config, active project, title, content, and workspace state restoration.
- AI integration tests assert stored-key fallback, explicit request-key precedence, and no key in responses.
- Node ZIP and packaged Electron smoke tests must launch twice and assert state created by the first process is restored by the second.
- Runtime tests assert `packages/workspace/src` is staged and no `.env`, tests, frontend source, cache, credentials, or `node_modules` enter release output.

### 7. Wrong vs Correct

#### Wrong

```js
localStorage.setItem("creator.theme", theme);
const server = await createCreatorServer({ rootDir });
```

#### Correct

```js
await api("/api/config", { method: "PATCH", body: { theme } });
const server = await createCreatorServer({ rootDir, dataRoot });
```

The UI talks to the Server projection, the Server owns active-editor synchronization, and Workspace alone owns disk formats and atomic writes.
