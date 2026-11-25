import { buildVerifiedRepairPlan, loadEditorFromContent } from "../../../packages/interface/src/index.js";
import { corsFetch } from "./cors-fetch.js";
import { backendError } from "./backend.js";

// Hosted only: the verified repair loop (model requests, trial applies, fixed-seed scoring)
// runs here so the page stays responsive. The page sends a snapshot of the deck and checks for
// concurrent edits itself when the result comes back.
self.addEventListener("message", async (event) => {
  const { id, input } = event.data ?? {};
  try {
    const editor = loadEditorFromContent(input.bundle);
    // The page owns the session request count: report each request and stop at its budget.
    let remaining = Number.isInteger(input.requestBudget) ? input.requestBudget : null;
    const countedFetch = async (url, init) => {
      if (remaining !== null && remaining <= 0) throw backendError("This Creator session reached its AI request limit. Raise it in Settings or reload the page.", "ai_session_budget");
      if (remaining !== null) remaining -= 1;
      self.postMessage({ id, type: "request" });
      return corsFetch(url, init);
    };
    const plan = await buildVerifiedRepairPlan({
      editor,
      config: input.config ?? {},
      credentials: input.credentials ?? {},
      instruction: input.instruction ?? "",
      targetCardId: input.targetCardId ?? null,
      repairTarget: input.repairTarget ?? null,
      diagnostics: input.diagnostics,
      fetchImpl: countedFetch,
      priorAttempts: input.priorAttempts ?? [],
      onProgress: (progress) => self.postMessage({ id, type: "progress", event: progress })
    });
    self.postMessage({ id, type: "result", result: plan });
  } catch (error) {
    self.postMessage({ id, type: "error", error: { message: error?.message ?? String(error), code: error?.code ?? "ai_repair_failed", stage: error?.stage ?? null, repairVerification: error?.repairVerification ?? null } });
  }
});
