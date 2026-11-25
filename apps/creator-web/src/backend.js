export class HttpCreatorBackend {
  #capabilityPromise;

  async request(path, options = {}) {
    try {
      return await this.#send(path, options, await this.#capability());
    } catch (error) {
      if (error?.code !== "api_capability_required") throw error;
      // The Creator Server rotates its capability token on restart. A stale
      // token is rejected before any handler runs, so one refresh + retry
      // recovers every request without side effects.
      return this.#send(path, options, await this.refreshSession());
    }
  }

  async #send(path, options, capability) {
    let requestPath = path;
    let headers = { "content-type": "application/json", "x-reigns-agent-capability": capability };
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    if (onProgress) headers.accept = "application/x-ndjson";
    let body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    if (path === "/api/ai/images/stage" && options.body) {
      const query = new URLSearchParams({ draftId: options.body.draftId ?? "", fileName: options.body.fileName ?? "input.png" });
      requestPath = `${path}?${query}`;
      headers = { "content-type": options.body.mimeType ?? "application/octet-stream", "x-reigns-agent-capability": capability };
      body = options.body.bytes;
    }
    const response = await fetch(requestPath, { method: options.method ?? "GET", headers, body, signal: options.signal });
    if (onProgress && response.ok && String(response.headers.get("content-type") ?? "").includes("application/x-ndjson")) {
      return readProgressStream(response, onProgress);
    }
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok || json?.error) throw backendError(json?.error?.message ?? `Request failed: ${response.status}`, json?.error?.code);
    return json;
  }

  async assetUrl(uri) {
    if (!uri) return "";
    const query = new URLSearchParams({ _reignsAgentCapability: await this.#capability() });
    return `/api/project-assets/${encodeURIComponent(uri)}?${query}`;
  }

  async refreshSession() {
    this.#capabilityPromise = undefined;
    return this.#capability();
  }

  #capability() {
    this.#capabilityPromise ??= fetch("/api/session", { headers: { accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || typeof payload?.capability !== "string") throw backendError(payload?.error?.message ?? "Creator API session could not be established", payload?.error?.code);
        return payload.capability;
      })
      .catch((error) => {
        this.#capabilityPromise = undefined;
        throw error;
      });
    return this.#capabilityPromise;
  }
}

export async function createCreatorBackend() {
  if (import.meta.env.VITE_CREATOR_HOST !== "browser") return new HttpCreatorBackend();
  const { BrowserCreatorBackend } = await import("./browser-backend.js");
  return BrowserCreatorBackend.create();
}

export function backendError(message, code = "creator_backend_error", stage = null) { const error = new Error(message); error.code = code; if (stage) error.stage = stage; return error; }

/**
 * readProgressStream consumes the Creator Server's opt-in NDJSON answer: progress lines
 * go to onProgress, the final result line resolves, an error line rejects with its stage.
 */
export async function readProgressStream(response, onProgress) {
  const reader = response.body?.getReader();
  if (!reader) throw backendError("Streaming response is not readable", "stream_unreadable");
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome = null;
  const handleLine = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "progress") {
      const { type, ...progress } = event;
      try { onProgress(progress); } catch { /* UI observers never break the request */ }
    } else if (event.type === "result" || event.type === "error") {
      outcome = event;
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  handleLine(buffer + decoder.decode());
  if (outcome?.type === "result") return outcome.result;
  if (outcome?.type === "error") throw backendError(outcome.error?.message ?? "Request failed", outcome.error?.code, outcome.error?.stage ?? null);
  throw backendError("Streaming response ended without a result", "stream_incomplete");
}
