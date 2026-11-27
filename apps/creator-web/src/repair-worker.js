import { buildVerifiedRepairPlan, loadEditorFromContent } from "../../../packages/interface/src/index.js";
import { corsFetch } from "./cors-fetch.js";
import { backendError } from "./backend.js";

// Hosted only: the verified repair loop (model requests, trial applies, fixed-seed scoring)
// runs here so the page stays responsive. The page sends a snapshot of the deck and checks for
// concurrent edits itself when the result comes back.
// Cancel is a message, not worker.terminate(): the loop stops at its next stage and returns the
// rounds it already ran (error.repairVerification), so the activity log can keep them.
const controllers = new Map();
// Request slots come from the page, which owns the single session counter.
const slotWaiters = new Map();
let slotSequence = 0;

function requestSlot(id) {
  slotSequence += 1;
  const seq = slotSequence;
  return new Promise((resolve) => {
    slotWaiters.set(seq, resolve);
    self.postMessage({ id, type: "request-slot", seq });
  });
}

self.addEventListener("message", async (event) => {
  if (event.data?.type === "cancel") {
    controllers.get(event.data.id)?.abort();
    return;
  }
  if (event.data?.type === "slot") {
    slotWaiters.get(event.data.seq)?.(event.data.granted === true);
    slotWaiters.delete(event.data.seq);
    return;
  }
  const { id, input } = event.data ?? {};
  const controller = new AbortController();
  controllers.set(id, controller);
  try {
    const editor = loadEditorFromContent(input.bundle);
    // Every request is admitted by the page's single counter before it is sent.
    const countedFetch = async (url, init) => {
      if (!(await requestSlot(id))) throw backendError("This Creator session reached its AI request limit. Raise it in Settings or reload the page.", "ai_session_budget");
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
      authorDeclined: input.authorDeclined ?? [],
      onProgress: (progress) => self.postMessage({ id, type: "progress", event: progress })
    });
    self.postMessage({ id, type: "result", result: plan });
  } catch (error) {
    self.postMessage({ id, type: "error", error: { message: error?.message ?? String(error), code: error?.code ?? "ai_repair_failed", stage: error?.stage ?? null, repairVerification: error?.repairVerification ?? null } });
  } finally {
    controllers.delete(id);
  }
});
