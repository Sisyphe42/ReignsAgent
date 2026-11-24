import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyAiEditPlan,
  buildVerifiedRepairPlan,
  DEFAULT_REPAIR_LOOP_LIMITS,
  collectIssueEntities,
  collectMissingProducerSignals,
  createCardEditor,
  evaluateRepairProposal,
  producerOnlyEdit,
  runDiagnostics
} from "../src/index.js";

const FOG = JSON.parse(readFileSync(new URL("../../../fixtures/content/fog-harbor.cards.json", import.meta.url), "utf8"));
const ENDPOINT_CONFIG = { provider: "openai_chat", endpoint: "http://mock.test/v1", modelId: "mock-model", apiKeyRef: "browser-local" };
const SECRET = "sk-test-secret-value";

function sealedWarehouseBundle() {
  const bundle = structuredClone(FOG);
  bundle.cards.push({
    id: "sealed-warehouse",
    text: "The quarantine is lifted. Warehouse seven can open.",
    weight: 1,
    requirements: { allTags: ["onWatch", "quarantineLifted"] },
    choices: [
      { id: "left", label: "Send the doctor first", effects: { factions: { gauge3: 5, gauge0: -5 }, tags: { warehouseChecked: true } } },
      { id: "right", label: "Unload at once", effects: { factions: { gauge0: 9, gauge1: -6 }, tags: { warehouseOpened: true } } }
    ]
  });
  return bundle;
}

function producerCard(id = "quarantine-board") {
  return {
    id,
    text: "The health board asks to end the quarantine.",
    weight: 1,
    requirements: { allTags: ["onWatch"] },
    choices: [
      { id: "left", label: "Lift it", effects: { factions: { gauge1: 4, gauge0: -3 }, tags: { quarantineLifted: true } } },
      { id: "right", label: "Keep it", effects: { factions: { gauge0: 3, gauge1: -4 } } }
    ]
  };
}

const PROPOSALS = {
  wipeGate: { id: "wipe-gate", title: "Open the warehouse", patches: [{ op: "updateCard", cardId: "sealed-warehouse", changes: { requirements: {} } }] },
  addProducer: { id: "add-producer", title: "Add a quarantine decision", patches: [{ op: "addCard", card: producerCard() }] },
  rename: { id: "rename", title: "Rename", patches: [{ op: "updateCard", cardId: "sealed-warehouse", changes: { id: "warehouse-two" } }] },
  disable: { id: "disable", title: "Disable", patches: [{ op: "updateCard", cardId: "sealed-warehouse", changes: { weight: 0 } }] },
  zeroEffects: {
    id: "zero-effects",
    title: "Produce the tag from first-fog",
    patches: [{ op: "setChoiceEffects", cardId: "first-fog", choiceId: "left", effects: { tags: { onWatch: true, lampAllNight: true, quarantineLifted: true } } }]
  },
  offScope: {
    id: "off-scope",
    title: "Fix plus a stray edit",
    patches: [
      { op: "addCard", card: producerCard() },
      { op: "updateCard", cardId: "council-audit", changes: { text: "Rewritten audit." } }
    ]
  },
  newError: {
    id: "new-error",
    title: "Producer plus a gated follow-up",
    patches: [
      { op: "addCard", card: producerCard() },
      { op: "addCard", card: { ...producerCard("followup"), requirements: { allTags: ["neverProduced"] } } }
    ]
  },
  leftOnly: {
    id: "left-only",
    title: "One-sided card",
    patches: [{ op: "addCard", card: { ...producerCard(), choices: [producerCard().choices[0]] } }]
  },
  metadata: { id: "metadata", title: "Rename deck", patches: [{ op: "setMetadata", metadata: { title: "x" } }] }
};

function chatResponse(proposals) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ proposals }) } }] })
  };
}

function scriptedFetch(rounds) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = rounds[Math.min(calls.length - 1, rounds.length - 1)];
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next();
    return chatResponse(next);
  };
  return { fetchImpl, calls };
}

function contextFor(bundle) {
  return { editor: createCardEditor(bundle) };
}

function stripTiming(value) {
  return JSON.parse(JSON.stringify(value, (key, entry) => (key === "timing" ? undefined : entry)));
}

function checkOf(proposal, id) {
  return proposal.verification.checks.find((check) => check.id === id);
}

describe("verified repair loop", () => {
  it("blocks the offline gate wipe and verifies the offline producer fix without touching the editor", async () => {
    const { editor } = contextFor(sealedWarehouseBundle());
    const before = JSON.stringify(editor.toBundle());
    const plan = await buildVerifiedRepairPlan({ editor });

    assert.equal(plan.verification.status, "verified");
    assert.equal(plan.verification.endpoint, "local_rules");
    assert.equal(plan.verification.roundsUsed, 1);
    const wipe = plan.proposals.find((proposal) => proposal.title.startsWith("Relax"));
    const producer = plan.proposals.find((proposal) => proposal.title === "Add missing tag producer");
    assert.equal(wipe.verification.passed, false);
    assert.deepEqual(wipe.verification.failedChecks, ["gates_preserved"]);
    assert.equal(producer.verification.passed, true);
    assert.equal(producer.verification.score.before, 55);
    assert.ok(producer.verification.score.after > 55);
    assert.equal(JSON.stringify(editor.toBundle()), before);
  });

  it("allows two full 120 s text requests inside the 300 s loop deadline", () => {
    assert.equal(DEFAULT_REPAIR_LOOP_LIMITS.deadlineMs, 300_000);
  });

  it("is deterministic for the same input", async () => {
    const first = await buildVerifiedRepairPlan({ editor: createCardEditor(sealedWarehouseBundle()) });
    const second = await buildVerifiedRepairPlan({ editor: createCardEditor(sealedWarehouseBundle()) });
    assert.deepEqual(stripTiming(first), stripTiming(second));
  });

  it("feeds failed checks back to the endpoint and stops at the first verified round", async () => {
    const { editor } = contextFor(sealedWarehouseBundle());
    const { fetchImpl, calls } = scriptedFetch([[PROPOSALS.wipeGate], [PROPOSALS.addProducer]]);
    const plan = await buildVerifiedRepairPlan({ editor, config: { ...ENDPOINT_CONFIG, apiKey: SECRET }, credentials: { apiKey: SECRET }, fetchImpl });

    assert.equal(calls.length, 2);
    assert.equal(plan.verification.status, "verified");
    assert.equal(plan.verification.stopReason, "verified");
    assert.deepEqual(plan.verification.rounds.map((round) => round.passedCount), [0, 1]);
    assert.deepEqual(plan.verification.rounds[0].blockedBy, { gates_preserved: 1 });

    const secondPrompt = calls[1].body.messages[1].content;
    const secondRequest = JSON.parse(secondPrompt.slice(secondPrompt.indexOf("Request:\n") + "Request:\n".length));
    const loop = secondRequest.context.constraints.repairLoop;
    assert.equal(loop.round, 2);
    assert.equal(loop.previousAttempts[0].proposalId, "wipe-gate");
    assert.equal(loop.previousAttempts[0].failedChecks[0].id, "gates_preserved");
    assert.ok(secondRequest.context.bundle.cards.some((card) => card.id === "sealed-warehouse"));

    assert.equal(calls[0].init.headers.authorization, `Bearer ${SECRET}`);
    for (const call of calls) assert.equal(call.init.body.includes(SECRET), false);
    assert.equal(JSON.stringify(plan).includes(SECRET), false);
    assert.equal(plan.verification.rounds[0].exchange[0].headers.authorization, "[redacted]");
    assert.equal(plan.config.constraints?.repairLoop, undefined);
  });

  it("stops after three rounds and returns the best failed round, none pre-approved", async () => {
    const { editor } = contextFor(sealedWarehouseBundle());
    const { fetchImpl, calls } = scriptedFetch([[PROPOSALS.wipeGate], [PROPOSALS.zeroEffects], [PROPOSALS.rename]]);
    const plan = await buildVerifiedRepairPlan({ editor, config: ENDPOINT_CONFIG, fetchImpl, limits: { maxRounds: 9 } });

    assert.equal(calls.length, 3, "hard cap is three rounds");
    assert.equal(plan.verification.status, "unverified");
    assert.equal(plan.verification.stopReason, "max_rounds");
    assert.equal(plan.verification.limits.maxRounds, 3);
    assert.ok(plan.proposals.every((proposal) => proposal.verification.passed === false));
    assert.ok([1, 2, 3].includes(plan.verification.selectedRound));
  });

  it("names the anti-shortcut check for each shortcut", async () => {
    const bundle = sealedWarehouseBundle();
    const { fetchImpl } = scriptedFetch([[
      PROPOSALS.rename, PROPOSALS.zeroEffects, PROPOSALS.offScope, PROPOSALS.newError, PROPOSALS.leftOnly
    ]]);
    const plan = await buildVerifiedRepairPlan({ editor: createCardEditor(bundle), config: ENDPOINT_CONFIG, fetchImpl, limits: { maxRounds: 1 } });
    const byId = new Map(plan.proposals.map((proposal) => [proposal.id, proposal]));

    assert.equal(checkOf(byId.get("rename"), "card_ids_preserved").passed, false);
    assert.equal(checkOf(byId.get("zero-effects"), "effects_preserved").passed, false);
    assert.equal(checkOf(byId.get("zero-effects"), "target_resolved").passed, true, "the shortcut would otherwise fix the issue");
    assert.equal(checkOf(byId.get("off-scope"), "scope").passed, false);
    assert.equal(checkOf(byId.get("new-error"), "no_new_errors").passed, false);
    assert.equal(checkOf(byId.get("left-only"), "player_valid").passed, false);
    assert.equal(plan.verification.status, "unverified");
  });

  it("feeds a rejected response back instead of stopping, and fails clearly if no round is usable", async () => {
    const editor = createCardEditor(sealedWarehouseBundle());
    const { fetchImpl, calls } = scriptedFetch([[PROPOSALS.disable], [PROPOSALS.addProducer]]);
    const plan = await buildVerifiedRepairPlan({ editor, config: ENDPOINT_CONFIG, fetchImpl });
    assert.equal(calls.length, 2);
    assert.equal(plan.verification.rounds[0].status, "rejected_response");
    assert.equal(plan.verification.status, "verified");
    const secondPrompt = calls[1].body.messages[1].content;
    assert.match(secondPrompt, /Response rejected/);

    const allBad = scriptedFetch([[PROPOSALS.disable]]);
    await assert.rejects(
      buildVerifiedRepairPlan({ editor, config: ENDPOINT_CONFIG, fetchImpl: allBad.fetchImpl }),
      (error) => error.code === "ai_repair_no_valid_response" && /weight/.test(error.message)
    );
    assert.equal(allBad.calls.length, 3);
  });

  it("exempts an unrelated card from scope only when the edit just adds the missing producer", async () => {
    const clearMorning = FOG.cards.find((entry) => entry.id === "clear-morning");
    const withTag = (choice, extra = {}) => ({ ...choice.effects, ...extra, tags: { ...(choice.effects.tags ?? {}), quarantineLifted: true } });
    const producerOnly = {
      id: "producer-on-clear-morning",
      title: "Lift quarantine at dawn",
      patches: clearMorning.choices.map((choice) => ({ op: "setChoiceEffects", cardId: "clear-morning", choiceId: choice.id, effects: withTag(choice) }))
    };
    const producerPlusGauge = {
      id: "producer-plus-gauge",
      title: "Lift quarantine and soften the dawn",
      patches: [{ op: "setChoiceEffects", cardId: "clear-morning", choiceId: "left", effects: { ...withTag(clearMorning.choices[0]), factions: { gauge0: 3, gauge1: 4, gauge3: 4 } } }]
    };
    const producerPlusGate = {
      id: "producer-plus-gate",
      title: "Lift quarantine and open the dawn",
      patches: [
        { op: "setChoiceEffects", cardId: "clear-morning", choiceId: "left", effects: withTag(clearMorning.choices[0]) },
        { op: "updateCard", cardId: "clear-morning", changes: { requirements: {} } }
      ]
    };
    const unrelatedTag = {
      id: "other-tag",
      title: "Set an unrelated tag",
      patches: [{ op: "setChoiceEffects", cardId: "clear-morning", choiceId: "left", effects: { ...clearMorning.choices[0].effects, tags: { ...(clearMorning.choices[0].effects.tags ?? {}), dawnBell: true } } }]
    };
    const { fetchImpl } = scriptedFetch([[producerOnly, producerPlusGauge, producerPlusGate, unrelatedTag]]);
    const plan = await buildVerifiedRepairPlan({
      editor: createCardEditor(sealedWarehouseBundle()),
      config: ENDPOINT_CONFIG,
      fetchImpl,
      repairTarget: { code: "unreachable_cards", cardIds: ["sealed-warehouse"] },
      limits: { maxRounds: 1 }
    });
    const byId = new Map(plan.proposals.map((proposal) => [proposal.id, proposal]));

    const exempt = checkOf(byId.get("producer-on-clear-morning"), "scope");
    assert.equal(exempt.passed, true);
    assert.deepEqual(exempt.exemptions, [{ cardId: "clear-morning", reason: "adds_missing_producer", signals: ["tag:quarantineLifted"] }]);
    assert.match(exempt.detail, /scope_exempt: adds_missing_producer/);
    assert.equal(byId.get("producer-on-clear-morning").verification.passed, true);

    assert.equal(checkOf(byId.get("producer-plus-gauge"), "scope").passed, false, "changing a gauge delta is not a producer-only edit");
    assert.equal(checkOf(byId.get("producer-plus-gate"), "scope").passed, false, "removing a gate is not a producer-only edit");
    assert.equal(checkOf(byId.get("producer-plus-gate"), "gates_preserved").passed, false);
    assert.equal(checkOf(byId.get("other-tag"), "scope").passed, false, "only the missing tag counts as a producer");
  });

  it("still counts producer-only edits toward the edited-card limit", async () => {
    const ids = ["oil-merchant", "ration-notice", "debt-collector", "contraband", "quiet-gift"];
    const fivePlaces = {
      id: "five-producers",
      title: "Lift quarantine everywhere",
      patches: ids.map((cardId) => {
        const choice = FOG.cards.find((entry) => entry.id === cardId).choices[0];
        return { op: "setChoiceEffects", cardId, choiceId: choice.id, effects: { ...choice.effects, tags: { ...(choice.effects.tags ?? {}), quarantineLifted: true } } };
      })
    };
    const { fetchImpl } = scriptedFetch([[fivePlaces]]);
    const plan = await buildVerifiedRepairPlan({ editor: createCardEditor(sealedWarehouseBundle()), config: ENDPOINT_CONFIG, fetchImpl, limits: { maxRounds: 1 } });
    const scope = checkOf(plan.proposals[0], "scope");
    assert.equal(scope.passed, false);
    assert.match(scope.detail, /5 existing cards edited; limit is 4/);
    assert.equal(scope.exemptions.length, 5);
  });

  it("defines a producer-only edit narrowly", () => {
    const missing = new Set(["var:riverToll"]);
    const before = { id: "a", text: "A", weight: 1, requirements: {}, choices: [{ id: "left", label: "L", effects: { factions: { gauge0: 1 } } }, { id: "right", label: "R", effects: { factions: { gauge1: 1 } } }] };
    const after = structuredClone(before);
    after.choices[0].effects.variables = { riverToll: "paid" };
    assert.deepEqual(producerOnlyEdit(before, after, missing), ["var:riverToll"]);
    const relabelled = structuredClone(after);
    relabelled.choices[0].label = "Changed";
    assert.equal(producerOnlyEdit(before, relabelled, missing), null);
    assert.equal(producerOnlyEdit(before, after, new Set(["var:other"])), null);
    const falsy = structuredClone(before);
    falsy.choices[0].effects.tags = { quarantineLifted: false };
    assert.equal(producerOnlyEdit(before, falsy, new Set(["tag:quarantineLifted"])), null);
  });

  it("extends the producer exemption up a multi-level missing chain with one rule", async () => {
    // archive-report needs sealOpened; only seal-breaker produces it and needs keyFound;
    // only key-search produces keyFound and needs ledgerTorn; nothing produces ledgerTorn.
    const bundle = structuredClone(FOG);
    const chainCard = (id, needs, makes) => ({
      id,
      text: `Chain card ${id}.`,
      weight: 1,
      requirements: { allTags: ["onWatch", needs] },
      choices: [
        { id: "left", label: "Yes", effects: { factions: { gauge0: 2, gauge1: -2 }, ...(makes ? { tags: { [makes]: true } } : {}) } },
        { id: "right", label: "No", effects: { factions: { gauge1: 2, gauge0: -2 }, ...(makes ? { tags: { [makes]: true } } : {}) } }
      ]
    });
    bundle.cards.push(chainCard("archive-report", "sealOpened", null), chainCard("seal-breaker", "keyFound", "sealOpened"), chainCard("key-search", "ledgerTorn", "keyFound"));
    const baseline = runDiagnostics({ cards: bundle.cards, metadata: bundle.metadata, cycles: 500, maxTurns: 40, seed: 1 });
    const missing = collectMissingProducerSignals({ cards: bundle.cards, reachableCardIds: new Set(baseline.graph.reachableCards), targetCardIds: ["archive-report"] });
    assert.deepEqual([...missing].sort(), ["tag:keyFound", "tag:ledgerTorn", "tag:sealOpened"]);

    const clearMorning = FOG.cards.find((entry) => entry.id === "clear-morning");
    const addTag = (tag, id) => ({
      id,
      title: `Produce ${tag} at dawn`,
      patches: [{ op: "setChoiceEffects", cardId: "clear-morning", choiceId: "left", effects: { ...clearMorning.choices[0].effects, tags: { ...(clearMorning.choices[0].effects.tags ?? {}), [tag]: true } } }]
    });
    const { fetchImpl } = scriptedFetch([[addTag("ledgerTorn", "root"), addTag("keyFound", "middle"), addTag("sealOpened", "nearest"), addTag("dawnBell", "unrelated")]]);
    const plan = await buildVerifiedRepairPlan({
      editor: createCardEditor(bundle),
      config: ENDPOINT_CONFIG,
      fetchImpl,
      repairTarget: { code: "unreachable_cards", cardIds: ["archive-report"] },
      limits: { maxRounds: 1 }
    });
    const byId = new Map(plan.proposals.map((proposal) => [proposal.id, proposal]));
    for (const id of ["root", "middle", "nearest"]) {
      const scope = checkOf(byId.get(id), "scope");
      assert.equal(scope.passed, true, `${id}: ${scope.detail}`);
      assert.equal(scope.exemptions[0].reason, "adds_missing_producer");
      assert.equal(checkOf(byId.get(id), "target_resolved").passed, true, id);
    }
    assert.equal(checkOf(byId.get("unrelated"), "scope").passed, false);
  });

  it("terminates on cycles and only treats anyTags as missing when every alternative is", () => {
    const card = (id, requirements, makes) => ({ id, requirements, choices: [{ id: "left", effects: makes ? { tags: { [makes]: true } } : {} }, { id: "right", effects: {} }] });
    const cards = [
      card("start", {}, "open"),
      card("target", { allTags: ["a"] }),
      card("loop-a", { allTags: ["b"] }, "a"),
      card("loop-b", { allTags: ["a"] }, "b"),
      card("either", { anyTags: ["open", "never"] }),
      card("neither", { anyTags: ["never", "nowhere"] })
    ];
    const reachable = new Set(["start", "either"]);
    assert.deepEqual([...collectMissingProducerSignals({ cards, reachableCardIds: reachable, targetCardIds: ["target"] })].sort(), ["tag:a", "tag:b"]);
    assert.deepEqual([...collectMissingProducerSignals({ cards, reachableCardIds: reachable, targetCardIds: ["either"] })], []);
    assert.deepEqual([...collectMissingProducerSignals({ cards, reachableCardIds: reachable, targetCardIds: ["neither"] })].sort(), ["tag:never", "tag:nowhere"]);
  });

  it("rejects disallowed operations and empty proposals before scoring", () => {
    const bundle = sealedWarehouseBundle();
    const baseline = runDiagnostics({ cards: bundle.cards, metadata: bundle.metadata, cycles: 500, maxTurns: 40, seed: 1 });
    const issues = collectIssueEntities(baseline);
    const context = {
      baseBundle: bundle,
      baseById: new Map(bundle.cards.map((card) => [card.id, card])),
      baseline,
      baselineKeys: new Set(issues.map((issue) => issue.key)),
      targets: issues.filter((issue) => issue.severity === "error"),
      relatedCards: new Set(bundle.cards.map((card) => card.id)),
      deadSignals: new Set(["tag:quarantineLifted"]),
      scoring: { cycles: 500, maxTurns: 40, seed: 1 },
      budget: { maxPatchesPerProposal: 8, maxEditedCards: 4 }
    };
    assert.equal(evaluateRepairProposal({ context, proposal: PROPOSALS.metadata }).checks.find((check) => check.id === "allowed_ops").passed, false);
    assert.equal(evaluateRepairProposal({ context, proposal: { id: "empty", title: "Empty", patches: [] } }).passed, false);
  });

  it("surfaces a first-round endpoint failure and keeps the best round when a later round fails", async () => {
    const editor = createCardEditor(sealedWarehouseBundle());
    const failing = scriptedFetch([() => ({ ok: false, status: 503, text: async () => "offline" })]);
    await assert.rejects(
      buildVerifiedRepairPlan({ editor, config: ENDPOINT_CONFIG, fetchImpl: failing.fetchImpl }),
      (error) => error.code === "endpoint_http_error"
    );

    const later = scriptedFetch([[PROPOSALS.wipeGate], () => ({ ok: false, status: 503, text: async () => "offline" })]);
    const plan = await buildVerifiedRepairPlan({ editor, config: ENDPOINT_CONFIG, fetchImpl: later.fetchImpl });
    assert.equal(plan.verification.status, "unverified");
    assert.equal(plan.verification.stopReason, "endpoint_error");
    assert.equal(plan.verification.rounds[1].status, "endpoint_error");
    assert.equal(plan.verification.rounds[1].error.code, "endpoint_http_error");
    assert.equal(plan.proposals[0].id, "wipe-gate");
  });

  it("enforces request byte and deadline budgets", async () => {
    const editor = createCardEditor(sealedWarehouseBundle());
    const { fetchImpl, calls } = scriptedFetch([[PROPOSALS.wipeGate]]);
    await assert.rejects(
      buildVerifiedRepairPlan({ editor, config: ENDPOINT_CONFIG, fetchImpl, limits: { maxRequestBytes: 1024 } }),
      (error) => error.code === "ai_repair_request_budget"
    );
    assert.equal(calls.length, 0, "the oversized request is never sent to the endpoint");

    let clock = 0;
    const timed = scriptedFetch([[PROPOSALS.wipeGate], [PROPOSALS.addProducer]]);
    const plan = await buildVerifiedRepairPlan({
      editor,
      config: ENDPOINT_CONFIG,
      fetchImpl: async (...args) => {
        clock += 310_000;
        return timed.fetchImpl(...args);
      },
      now: () => clock
    });
    assert.equal(plan.verification.stopReason, "deadline");
    assert.equal(timed.calls.length, 1);
  });

  it("reports story-group issues as not verifiable instead of pretending to score them", async () => {
    const plan = await buildVerifiedRepairPlan({ editor: createCardEditor(sealedWarehouseBundle()), repairTarget: { code: "story_group_unvisited" } });
    assert.equal(plan.verification.status, "not_verifiable");
    assert.ok(plan.proposals.every((proposal) => proposal.verification === undefined));
  });

  it("does not invent a verification when the scoring review finds nothing", async () => {
    const authorReview = { warnings: [{ code: "low_card_cycle_coverage", severity: "warning", details: { cards: [{ cardId: "foghorn" }] } }] };
    const plan = await buildVerifiedRepairPlan({ editor: createCardEditor(structuredClone(FOG)), diagnostics: authorReview });
    assert.equal(plan.verification.status, "not_verifiable");
    assert.equal(plan.verification.stopReason, "no_scored_issues");
    assert.equal(plan.request.context.diagnostics.warnings[0].code, "low_card_cycle_coverage");
  });

  it("keeps a specific target unverified when the scoring review does not contain it", async () => {
    const plan = await buildVerifiedRepairPlan({
      editor: createCardEditor(sealedWarehouseBundle()),
      repairTarget: { code: "unreachable_cards", cardIds: ["first-fog"] }
    });
    assert.equal(plan.verification.status, "not_verifiable");
    assert.equal(plan.verification.stopReason, "target_entity_not_scored");
    assert.deepEqual(plan.verification.targets, []);
    assert.ok(plan.proposals.every((proposal) => proposal.verification === undefined), "nothing is marked verified for a different card");

    const partial = await buildVerifiedRepairPlan({
      editor: createCardEditor(sealedWarehouseBundle()),
      repairTarget: { code: "unreachable_cards", cardIds: ["sealed-warehouse", "first-fog"] }
    });
    assert.deepEqual(partial.verification.targets.map((target) => target.entity), ["card:sealed-warehouse"]);
    assert.deepEqual(partial.verification.unmatchedTargets, ["card:first-fog"]);
  });

  it("targets only the requested issue entities", async () => {
    const plan = await buildVerifiedRepairPlan({
      editor: createCardEditor(sealedWarehouseBundle()),
      repairTarget: { code: "unsatisfied_required_tags", entities: ["tag:quarantineLifted"] }
    });
    assert.deepEqual(plan.verification.targets, [{ code: "unsatisfied_required_tags", severity: "error", entity: "tag:quarantineLifted" }]);
  });

  it("rejects a stale editor and keeps apply guarded by fingerprint and player validation", async () => {
    const editor = createCardEditor(sealedWarehouseBundle());
    const changed = createCardEditor({ ...sealedWarehouseBundle(), cards: sealedWarehouseBundle().cards.slice(1) });
    await assert.rejects(buildVerifiedRepairPlan({ editor, getEditor: () => changed }), (error) => error.code === "ai_repair_stale");

    const plan = await buildVerifiedRepairPlan({ editor });
    const passed = plan.proposals.filter((proposal) => proposal.verification.passed).map((proposal) => proposal.id);
    const applied = applyAiEditPlan({ editor, plan, proposalIds: passed });
    assert.equal(applied.playerValidation.valid, true);

    const broken = {
      ...plan,
      proposals: [{ id: "broken", title: "Broken", patches: [{ op: "updateCard", cardId: "first-fog", changes: { choices: [FOG.cards[0].choices[0]] } }], verification: { passed: true } }]
    };
    assert.throws(() => applyAiEditPlan({ editor, plan: broken, proposalIds: ["broken"] }), (error) => error.code === "ai_repair_player_invalid");
    assert.throws(() => applyAiEditPlan({ editor: changed, plan, proposalIds: passed }), /stale/);
  });
});
