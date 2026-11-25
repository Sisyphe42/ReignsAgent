import { buildVerifiedRepairPlan, loadEditorFromContent } from "../../../packages/interface/src/index.js";
import { corsFetch } from "./cors-fetch.js";
import { backendError } from "./backend.js";

// Hosted only: the verified repair loop (model requests, trial applies, fixed-seed scoring)
// runs here so the page stays responsive. The page sends a snapshot of the deck and checks for
// concurrent edits itself when the result comes back.
// Cancel is a message, not worker.terminate(): the loop stops at its next stage and returns the
// rounds it already ran (error.repairVerification), so the activity log can keep them.
const controllers = new Map();

self.addEventListener("message", async (event) => {
  if (event.data?.type === "cancel") {
    controllers.get(event.data.id)?.abort();
    return;
  }
  const { id, input } = event.data ?? {};
  const controller = new AbortController();
  controllers.set(id, controller);
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
      signal: controller.signal,
      priorAttempts: input.priorAttempts ?? [],
      onProgress: (progress) => self.postMessage({ id, type: "progress", event: progress })
    });
    self.postMessage({ id, type: "result", result: plan });
  } catch (error) {
    self.postMessage({ id, type: "error", error: { message: error?.message ?? String(error), code: error?.code ?? "ai_repair_failed", stage: error?.stage ?? null, repairVerification: error?.repairVerification ?? null } });
  } finally {
    controllers.delete(id);
  }
});
