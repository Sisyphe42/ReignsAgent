import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildAiEditPlanAsync, buildVerifiedRepairPlan, createCardEditor, runDiagnostics, runDiagnosticsAsync } from "../src/index.js";

const FOG = JSON.parse(readFileSync(new URL("../../../fixtures/content/fog-harbor.cards.json", import.meta.url), "utf8"));
const ENDPOINT_CONFIG = { provider: "openai_chat", endpoint: "http://mock.test/v1", modelId: "mock-model", apiKeyRef: "browser-local" };

function sealedWarehouseBundle() {
  const bundle = structuredClone(FOG);
  bundle.cards.push({
    id: "sealed-warehouse",
    text: "The quarantine is lifted. Warehouse seven can open.",
    weight: 1,
    requirements: { allTags: ["onWatch", "quarantineLifted"] },
    choices: [
      { id: "left", label: "Send the doctor first", effects: { factions: { gauge3: 5, gauge0: -5 } } },
      { id: "right", label: "Unload at once", effects: { factions: { gauge0: 9, gauge1: -6 } } }
    ]
  });
  return bundle;
}

const ADD_PRODUCER = {
  id: "quarantine-board",
  title: "Add a quarantine decision",
  summary: "A health-board card can lift the quarantine.",
  patches: [{
    op: "addCard",
    card: {
      id: "quarantine-board",
      text: "The health board asks to end the quarantine.",
      weight: 1,
      requirements: { allTags: ["onWatch"] },
      choices: [
        { id: "left", label: "Lift it", effects: { factions: { gauge1: 4, gauge0: -3 }, tags: { quarantineLifted: true } } },
        { id: "right", label: "Keep it", effects: { factions: { gauge0: 3, gauge1: -4 } } }
      ]
    }
  }]
};
const WIPE_GATE = { id: "wipe-gate", title: "Open the warehouse", summary: "Remove the gate.", patches: [{ op: "updateCard", cardId: "sealed-warehouse", changes: { requirements: {} } }] };

function chat(proposals) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ proposals }) } }] }) };
}

function scripted(steps) {
  let calls = 0;
  return async () => {
    const step = steps[Math.min(calls, steps.length - 1)];
    calls += 1;
    if (typeof step === "function") return step();
    return chat(step);
  };
}

describe("real progress events", () => {
  it("runDiagnosticsAsync matches runDiagnostics and reports simulate then summarize", async () => {
    const input = { cards: FOG.cards, metadata: FOG.metadata, cycles: 120, maxTurns: 20, seed: 2 };
    const events = [];
    const asyncResult = await runDiagnosticsAsync({ ...input, onProgress: (event) => events.push(event) });
    assert.deepEqual(asyncResult, runDiagnostics(input));
    assert.deepEqual(events.map((event) => event.phase), ["simulate", "simulate", "simulate", "summarize"]);
    assert.deepEqual(events.at(-1), { phase: "summarize", completed: 120, total: 120 });
  });

  it("reports endpoint stages in order: context, request, response, parse, validate", async () => {
    const stages = [];
    await buildAiEditPlanAsync({
      editor: createCardEditor(FOG),
      config: ENDPOINT_CONFIG,
      mode: "generate_cards",
      instruction: "Draft one card.",
      fetchImpl: scripted([[]]),
      onProgress: (event) => stages.push(event.stage)
    });
    assert.deepEqual(stages, ["context", "request", "response", "parse", "validate"]);
  });

  it("reports the local planner as context, draft, validate", async () => {
    const stages = [];
    await buildAiEditPlanAsync({ editor: createCardEditor(FOG), mode: "generate_cards", instruction: "Draft one card.", onProgress: (event) => stages.push(event.stage) });
    assert.deepEqual(stages, ["context", "draft", "validate"]);
  });

  it("marks an HTTP 503 as a request-stage failure and a malformed answer as a parse failure", async () => {
    const unavailable = await buildAiEditPlanAsync({
      editor: createCardEditor(FOG),
      config: ENDPOINT_CONFIG,
      instruction: "Draft one card.",
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => "{\"error\":\"busy\"}" })
    }).catch((error) => error);
    assert.equal(unavailable.code, "endpoint_http_error");
    assert.equal(unavailable.stage, "request");

    const malformed = await buildAiEditPlanAsync({
      editor: createCardEditor(FOG),
      config: ENDPOINT_CONFIG,
      instruction: "Draft one card.",
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "not json at all" })
    }).catch((error) => error);
    assert.ok(malformed instanceof Error);
    assert.equal(malformed.stage, "parse");
  });

  it("reports repair-loop rounds and per-proposal trial, scoring, and checks stages", async () => {
    const events = [];
    const plan = await buildVerifiedRepairPlan({
      editor: createCardEditor(sealedWarehouseBundle()),
      config: ENDPOINT_CONFIG,
      fetchImpl: scripted([[WIPE_GATE], [ADD_PRODUCER]]),
      onProgress: (event) => events.push(event),
      yieldToHost: async () => {}
    });
    assert.equal(plan.verification.status, "verified");
    assert.equal(events[0].stage, "baseline");
    assert.ok(events.every((event) => event.maxRounds === 3));
    const roundTwo = events.filter((event) => event.round === 2).map((event) => event.stage);
    assert.deepEqual(roundTwo, ["context", "request", "response", "parse", "validate", "trial", "scoring", "checks", "done"]);
    const trial = events.find((event) => event.round === 1 && event.stage === "trial");
    assert.deepEqual([trial.proposalIndex, trial.proposalCount], [1, 1]);
    assert.deepEqual(events.at(-1), { maxRounds: 3, stage: "done", round: 2, stopReason: "verified" });
  });

  it("stops a round-one endpoint failure on the request stage", async () => {
    const events = [];
    const error = await buildVerifiedRepairPlan({
      editor: createCardEditor(sealedWarehouseBundle()),
      config: ENDPOINT_CONFIG,
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => "{}" }),
      onProgress: (event) => events.push(event),
      yieldToHost: async () => {}
    }).catch((caught) => caught);
    assert.equal(error.stage, "request");
    assert.equal(events.at(-1).stage, "request");
    assert.equal(events.at(-1).round, 1);
  });
});
