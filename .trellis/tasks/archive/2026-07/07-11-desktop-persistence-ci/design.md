# Design

## Storage boundary

Add a host-neutral workspace package responsible for TOML config, project discovery, atomic writes, per-process write serialization, and project lifecycle. The Creator Server owns one workspace instance and keeps its editor synchronized with the active project.

Data layout:

```text
ReignsAgentData/
  config.toml
  projects/<uuid>/
    project.toml
    content.json
    workspace.toml
    assets/
    reviews/
    builds/
  Builds/
```

`config.toml` contains schema version, theme, locale, active/recent project IDs, build defaults, and AI endpoint settings including a plaintext API key. API projections expose only `hasApiKey`. `project.toml` contains ID, schema version, timestamps, and content path. `content.json.metadata.title` remains the only project title source.

## Server and UI contracts

The Creator Server accepts `dataRoot`, initializes the workspace, opens the configured active project or creates a sample project on first run, and persists every successful editor mutation. It adds `/api/config` and `/api/projects` lifecycle routes while retaining current routes. Stored credentials fill missing request credentials; an explicit request key takes precedence.

The WebUI loads config/projects from the server. Global skin and AI settings no longer use localStorage as authority. Project-local navigation state is patched through the server. The API key field shows saved presence, supports replace/clear, and never receives the stored value.

## Host integration and CI

Electron passes its existing portable data root into the utility process. Release launchers default to `ReignsAgentData` beside the extracted ZIP and accept an override. Development defaults to a gitignored repo-local data directory.

CI uses PR plus master-push triggers with concurrency cancellation, Node 22/24, and current Node-24-based GitHub actions. Linux Electron commands receive `--no-sandbox` only inside CI. Native artifact jobs test the packaged executable and verify persistent beside-app data.

## Compatibility and failure handling

- Existing in-memory `initialBundle` tests remain supported through an ephemeral workspace mode or explicit test data roots.
- Invalid TOML or manifests fail startup with a path-specific error and do not overwrite the source file.
- File writes use a same-directory temporary file followed by rename; a rejected mutation leaves the previous file intact.
- Deleting the active project selects the most recently used remaining project; deleting the final project creates a blank project.
- Unknown config keys may be normalized away when the application rewrites TOML; comments are not preserved.
