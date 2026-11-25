import { runDiagnostics } from "../../../packages/interface/src/index.js";

// The simulation runs synchronously in this worker; progress messages are delivered to the
// page while it runs, so the Review panel can show real completed/total cycles.
self.addEventListener("message", (event) => {
  const { id, input } = event.data ?? {};
  try {
    const result = runDiagnostics({ ...input, onProgress: (progress) => self.postMessage({ id, type: "progress", event: progress }) });
    self.postMessage({ id, type: "result", progress: 1, result });
  } catch (error) {
    self.postMessage({ id, type: "error", error: { message: error?.message ?? String(error), code: error?.code ?? "review_failed" } });
  }
});
