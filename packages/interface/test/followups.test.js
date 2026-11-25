import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildVerifiedRepairPlan, checkNarrativeQuality, createCardEditor, createRepairHistoryRecord } from "../src/index.js";
import { extractAgentDirectives } from "../../pipeline/src/index.js";

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

const WIPE_GATE = { id: "wipe-gate", title: "Open the warehouse", summary: "Remove the gate.", patches: [{ op: "updateCard", cardId: "sealed-warehouse", changes: { requirements: {} } }] };
const ADD_PRODUCER = {
  id: "quarantine-board",
  title: "Add a quarantine decision",
  summary: "A health-board card can lift the quarantine.",
  patches: [{ op: "addCard", card: { id: "quarantine-board", text: "卫生署请求解除检疫，七号仓终于可以开门。", weight: 1, requirements: { allTags: ["onWatch"] }, choices: [
    { id: "left", label: "解除检疫", effects: { factions: { gauge1: 4, gauge0: -3 }, tags: { quarantineLifted: true } } },
    { id: "right", label: "继续封港", effects: { factions: { gauge0: 3, gauge1: -4 } } }
  ] } }]
};

function scripted(documents) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const document = documents[Math.min(calls.length - 1, documents.length - 1)];
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(document) } }] }) };
  };
  return { fetchImpl, calls };
}

function requestContextOf(call) {
  const prompt = call.messages[1].content;
  return JSON.parse(prompt.slice(prompt.indexOf("Request:\n") + "Request:\n".length)).context;
}

describe("model loop directives", () => {
  it("bounds and cleans context requests and stop directives", () => {
    const directives = extractAgentDirectives({ contextRequests: ["a", "a", { cardId: "b" }, 3, "c", "d", "e", "f", "g"], stop: { reason: "needs the author" } });
    assert.deepEqual(directives.contextRequests, ["a", "b", "c", "d", "e", "f"]);
    assert.deepEqual(directives.stop, { reason: "needs the author" });
    assert.deepEqual(extractAgentDirectives({ proposals: [] }), { contextRequests: [], stop: null });
  });

  it("sends the cards the model asked for in the next round and ignores unknown ids", async () => {
    const { fetchImpl, calls } = scripted([
      { proposals: [WIPE_GATE], contextRequests: ["clear-morning", "no-such-card"] },
      { proposals: [ADD_PRODUCER] }
    ]);
    const plan = await buildVerifiedRepairPlan({ editor: createCardEditor(sealedWarehouseBundle()), config: ENDPOINT_CONFIG, fetchImpl, yieldToHost: async () => {} });
    assert.equal(plan.verification.status, "verified");
    assert.deepEqual(plan.verification.rounds[0].agent, { contextRequests: ["clear-morning"], ignoredRequests: ["no-such-card"] });
    assert.deepEqual(plan.verification.requestedCardIds, ["clear-morning"]);
    const second = requestContextOf(calls[1]);
    assert.equal(second.constraints.repairLoop.requestedCardIds[0], "clear-morning");
    assert.equal(second.bundle.cardSelection.reasons["clear-morning"], "target: requested by the model");
    assert.ok(Number.isFinite(plan.verification.rounds[0].timing.requestMs));
  });

  it("lets the model end the loop when it says the author must decide", async () => {
    const { fetchImpl, calls } = scripted([
      { proposals: [WIPE_GATE] },
      { proposals: [], stop: { reason: "The author must decide when the quarantine ends." } }
    ]);
    const plan = await buildVerifiedRepairPlan({ editor: createCardEditor(sealedWarehouseBundle()), config: ENDPOINT_CONFIG, fetchImpl, yieldToHost: async () => {} });
    assert.equal(calls.length, 2, "no third round after the stop");
    assert.equal(plan.verification.stopReason, "model_stopped");
    assert.deepEqual(plan.verification.agentStop, { round: 2, reason: "The author must decide when the quarantine ends." });
    const record = createRepairHistoryRecord({ plan, id: "rh-unit-stop01" });
    assert.equal(record.agentStop.round, 2);
    assert.equal(record.rounds[1].agent.stop.reason, "The author must decide when the quarantine ends.");
    assert.ok(record.conversation.length >= 2, "keeps the logged conversation");
    assert.equal(JSON.stringify(record.conversation).includes("mock.test"), false, "conversation excludes endpoint URLs");
  });
});

describe("failed loops keep their evidence", () => {
  it("attaches the recorded round to a round-one endpoint failure", async () => {
    const fetchImpl = async () => ({ ok: false, status: 503, text: async () => "{}" });
    const error = await buildVerifiedRepairPlan({ editor: createCardEditor(sealedWarehouseBundle()), config: ENDPOINT_CONFIG, fetchImpl, yieldToHost: async () => {} }).catch((caught) => caught);
    assert.equal(error.repairVerification.status, "failed");
    assert.equal(error.repairVerification.rounds[0].status, "endpoint_error");
    assert.ok(error.repairVerification.rounds[0].exchange.length >= 1);
    const record = createRepairHistoryRecord({ error, id: "rh-unit-fail01" });
    assert.equal(record.status, "failed");
    assert.equal(record.rounds.length, 1);
    assert.ok(record.conversation.length >= 1);
    assert.equal(record.baseline.healthScore, 55);
  });

  it("keeps a failed round when the target cannot be scored", async () => {
    const fetchImpl = async () => ({ ok: false, status: 503, text: async () => "{}" });
    const error = await buildVerifiedRepairPlan({ editor: createCardEditor(sealedWarehouseBundle()), config: ENDPOINT_CONFIG, repairTarget: { code: "never_reported_issue" }, fetchImpl, yieldToHost: async () => {} }).catch((caught) => caught);
    assert.equal(error.code, "endpoint_http_error");
    assert.equal(error.repairVerification.rounds[0].error.code, "endpoint_http_error");
  });
});

describe("narrative quality advisory", () => {
  it("flags placeholder text, copied cards, unusable labels, and a different script; passes deck-like writing", () => {
    const base = new Map(FOG.cards.map((card) => [card.id, card]));
    const after = new Map(base);
    after.set("bad", { id: "bad", text: "TODO", choices: [{ id: "left", label: "Left" }, { id: "right", label: "Right" }] });
    after.set("copy", { id: "copy", text: FOG.cards[0].text, choices: [{ id: "left", label: "同意" }, { id: "right", label: "同意" }] });
    after.set("english", { id: "english", text: "The harbour master demands an answer before dawn.", choices: [{ id: "left", label: "Agree" }, { id: "right", label: "Refuse" }] });
    after.set("quarantine-board", ADD_PRODUCER.patches[0].card);
    const problems = checkNarrativeQuality(base, after, [], ["bad", "copy", "english", "quarantine-board"]);
    assert.ok(problems.some((line) => line.startsWith("bad: card text is empty or a placeholder")));
    assert.ok(problems.some((line) => line.startsWith("bad: a choice label")));
    assert.ok(problems.some((line) => line.startsWith(`copy: same text as ${FOG.cards[0].id}`)));
    assert.ok(problems.some((line) => line.startsWith("copy: both choices have the same label")));
    assert.ok(problems.some((line) => line.startsWith("english: written in a different script")));
    assert.equal(problems.some((line) => line.startsWith("quarantine-board:")), false);
  });
});
