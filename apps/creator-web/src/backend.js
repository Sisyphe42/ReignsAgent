export class HttpCreatorBackend {
  async request(path, options = {}) {
    const response = await fetch(path, { method: options.method ?? "GET", headers: { "content-type": "application/json" }, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok || json?.error) throw backendError(json?.error?.message ?? `Request failed: ${response.status}`, json?.error?.code);
    return json;
  }
}

export async function createCreatorBackend() {
  if (import.meta.env.VITE_CREATOR_HOST !== "browser") return new HttpCreatorBackend();
  const { BrowserCreatorBackend } = await import("./browser-backend.js");
  return BrowserCreatorBackend.create();
}

export function backendError(message, code = "creator_backend_error") { const error = new Error(message); error.code = code; return error; }
