export class HttpCreatorBackend {
  async request(path, options = {}) {
    let requestPath = path;
    let headers = { "content-type": "application/json" };
    let body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    if (path === "/api/ai/images/stage" && options.body) {
      const query = new URLSearchParams({ draftId: options.body.draftId ?? "", fileName: options.body.fileName ?? "input.png" });
      requestPath = `${path}?${query}`;
      headers = { "content-type": options.body.mimeType ?? "application/octet-stream" };
      body = options.body.bytes;
    }
    const response = await fetch(requestPath, { method: options.method ?? "GET", headers, body, signal: options.signal });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok || json?.error) throw backendError(json?.error?.message ?? `Request failed: ${response.status}`, json?.error?.code);
    return json;
  }
  async assetUrl(uri) { return uri ? `/api/project-assets/${encodeURIComponent(uri)}` : ""; }
}

export async function createCreatorBackend() {
  if (import.meta.env.VITE_CREATOR_HOST !== "browser") return new HttpCreatorBackend();
  const { BrowserCreatorBackend } = await import("./browser-backend.js");
  return BrowserCreatorBackend.create();
}

export function backendError(message, code = "creator_backend_error") { const error = new Error(message); error.code = code; return error; }
