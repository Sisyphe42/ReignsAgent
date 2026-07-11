import { runDiagnostics } from "../../../packages/interface/src/index.js";

self.addEventListener("message", (event) => {
  const { id, input } = event.data ?? {};
  try {
    self.postMessage({ id, type: "progress", progress: 0.05 });
    const result = runDiagnostics(input);
    self.postMessage({ id, type: "result", progress: 1, result });
  } catch (error) {
    self.postMessage({ id, type: "error", error: { message: error?.message ?? String(error), code: error?.code ?? "review_failed" } });
  }
});
