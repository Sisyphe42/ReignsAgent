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
- Browser APIs stay in `apps/creator-web/src/opfs-workspace.js`; `packages/workspace` exports only host-neutral contracts and the Node filesystem adapter.
- Hosted Workspace imports validate the full snapshot before mutation, map imported project ids into active/recent config state, restore project-local workspace state, and omit `ai.apiKey` entirely unless explicitly included.
- Nonessential client-local UI preferences may use `localStorage` only through exception-safe helpers. Unavailable or throwing storage reads use product defaults, and failed writes/removals are silent no-ops that must not block Creator startup or interaction.

### 4. Validation & Error Matrix

- Missing data root -> `WorkspaceError` with `data_root_required`.
- Invalid TOML -> path-specific `toml_parse_failed`; source file remains unchanged.
- Unsupported config/project/workspace schema -> corresponding `*_schema_unsupported` error.
- Invalid project ID/path -> `project_id_invalid`; never resolve an arbitrary filesystem path.
- Failed editor mutation -> do not enqueue or write a replacement bundle.
- Delete active project -> select the newest remaining project; deleting the last project creates a blank project.
- Missing or throwing `localStorage` -> default the rail to expanded and pinned; keep current-session React state interactive without reporting a persistence error.

### 5. Good/Base/Bad Cases

- Good: rename a project, restart on another random port, and restore the same title because disk state is authoritative.
- Base: choose Sample, clone the immutable fixture into a normal project, then edit it independently.
- Bad: persist theme, endpoint metadata, project content, or API keys only in `localStorage`; Electron random-port origins make that state unstable.
- Bad: import a new package from Creator Server without adding it to the shared runtime allowlist; source tests pass but extracted releases fail at module resolution.
- Bad: call `localStorage.getItem`, `setItem`, or `removeItem` directly for optional UI state; privacy modes and restricted origins may throw even when the property exists.

### 6. Tests Required

- Workspace unit tests assert TOML defaults/round-trip, project isolation, atomic serialized writes, malformed-file preservation, and API-key redaction.
- Creator Server integration tests restart over one data root and assert config, active project, title, content, and workspace state restoration.
- AI integration tests assert stored-key fallback, explicit request-key precedence, and no key in responses.
- Node ZIP and packaged Electron smoke tests must launch twice and assert state created by the first process is restored by the second.
- Runtime tests assert `packages/workspace/src` is staged and no `.env`, tests, frontend source, cache, credentials, or `node_modules` enter release output.
- Hosted browser tests inject both a throwing `window.localStorage` accessor and throwing storage methods, then assert Creator reaches its loaded state with default rail state and working rail controls.

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

For optional client-local preferences, guard the property access and the operation together:

```js
// Wrong: the accessor or method may throw before Creator mounts.
localStorage.setItem(key, value);

// Correct: optional persistence degrades without affecting current-session state.
try {
  window.localStorage?.setItem(key, value);
} catch {
  // Preference persistence is nonessential.
}
```

## Scenario: Windows Project release persistence

### 1. Scope / Trigger

- Trigger: changes to Windows Project packaging, release API routes, release history, packaged Creator staging, or `ReignsAgentData/Builds` resolution.
- Scope: local Windows x64 Node/Electron Creator only. Hosted keeps Web ZIP export, and non-Windows local hosts report the target unavailable.

### 2. Signatures

- `createCreatorServer({ windowsPlayerHostPath?, enableWindowsRelease?, ... })`
- `workspace.getReleaseOutput({ fileName })`
- `workspace.listReleases()` / `saveRelease(record)` / `resolveReleaseArtifact(id)` / `deleteRelease(id)`
- `GET /api/releases`
- `POST /api/releases/windows-x64`
- `GET /api/releases/:id/artifact`
- `DELETE /api/releases/:id`
- `npm run build:player:windows` / `npm run test:player:windows`

### 3. Contracts

- Release record fields are fixed: `schemaVersion`, `id`, `projectId`, `buildId`, `title`, `version`, `target`, `createdAt`, `artifactRelativePath`, `size`, and `sha256`.
- `target` is exactly `windows-x64`; artifacts resolve below `ReignsAgentData/Builds/<active-project-id>/` and records below `projects/<id>/builds/`.
- A successful write is ordered: validate Project -> append versioned payload -> atomically rename EXE -> verify size/hash -> atomically write record. No record may precede the artifact.
- Build IDs derive deterministically from normalized authored content. Re-publishing the same build reuses its existing verified record and artifact.
- The staged native host is optional on non-Windows runtimes and required for Windows release capability. Creator users never compile it; distribution builders run the MSVC build first.
- Payload files are player-only: `player.html`, stitched player runtime, `.game.json`, default logo, and referenced assets. Creator, AI, Pipeline, Reviewer, endpoint configuration, and credentials are forbidden.
- Creator Electron remains ZIP-only. The single EXE is a Project player artifact, not a Creator distribution.

### 4. Validation & Error Matrix

- Unsupported host -> capability `windowsX64: false` with `windows_host_required`.
- Missing staged host -> capability `windowsX64: false` with `player_host_missing`.
- Invalid player cards -> build rejection; no EXE and no record.
- Unsafe file/artifact path, duplicate payload path, invalid footer/bounds, or hash mismatch -> reject without loading or downloading the artifact.
- Project mismatch or foreign release ID -> `release_project_mismatch` or `release_not_found`; never expose another Project's artifact.
- Artifact missing, wrong size, or wrong SHA-256 -> `release_artifact_missing` or `release_artifact_mismatch`.

### 5. Good/Base/Bad Cases

- Good: publish on Windows, restart Creator from another working directory, list the same record, and download the verified EXE from the portable data root.
- Base: skip Review, show a warning, and publish after player validation passes.
- Bad: write the release record before the final atomic EXE rename, or resolve output relative to `process.cwd()`.
- Bad: place the WebView2 user-data folder beside the EXE or embed endpoint settings in `.game.json`.

### 6. Tests Required

- Payload unit tests assert deterministic ordering, path traversal/duplicate rejection, footer/bounds corruption, and payload/file SHA-256 validation.
- Workspace/API tests assert publish, restart restore, verified download, confirmed delete, active-Project isolation, failure cleanup, and portable `Builds` anchoring.
- Ubuntu verification uses a fake host for transport and persistence logic. Windows CI builds the static WebView2 Loader host, publishes through the real API, and runs `--smoke-test` to assert WebView2 initialization, title, and card count.
- Deployable-player and packaged Creator smoke gates remain required because the release reuses those runtime and staging paths.

### 7. Wrong vs Correct

#### Wrong

```js
const output = resolve(process.cwd(), `${build.buildId}.exe`);
await workspace.saveRelease(record);
await writeFile(output, executable);
```

#### Correct

```js
const output = await workspace.getReleaseOutput({ fileName });
await writeBinaryAtomic(output.artifactPath, executable);
await workspace.saveRelease(record); // verifies active Project, size, and SHA-256
```
