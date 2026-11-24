import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAiContext, buildCardEditRequest, collectAiCardSignals, createAiEditSuggestions, selectAiContextCards } from "../src/index.js";

function card(id, { requirements = {}, left = {}, right = {}, text = `Card ${id}` } = {}) {
  return {
    id,
    text,
    weight: 1,
    requirements,
    choices: [
      { id: "left", label: "Left", effects: { factions: { gauge0: 1 }, ...left } },
      { id: "right", label: "Right", effects: { factions: { gauge1: -1 }, ...right } }
    ]
  };
}

function fillerDeck(count) {
  return Array.from({ length: count }, (_, index) => card(`filler-${index + 1}`));
}

describe("AI context card selection", () => {
  it("includes a diagnostic card that sits beyond the old first-12 slice", () => {
    const cards = [
      card("opening", { left: { tags: { onWatch: true } } }),
      ...fillerDeck(14),
      card("sealed", { requirements: { allTags: ["onWatch", "quarantineLifted"] } })
    ];
    const diagnostics = {
      warnings: [
        { code: "unreachable_cards", severity: "error", message: "unreachable", details: { cardIds: ["sealed"] } },
        { code: "unsatisfied_required_tags", severity: "error", message: "tags", details: { tags: ["quarantineLifted"] } }
      ]
    };

    const context = buildAiContext({ bundle: { cards }, diagnostics, mode: "repair_diagnostics" });
    const ids = context.bundle.cards.map((entry) => entry.id);

    assert.ok(ids.includes("sealed"), "the broken card must reach the model");
    assert.ok(ids.includes("opening"), "the onWatch producer is a graph neighbour");
    assert.equal(context.bundle.cardSelection.strategy, "relevance_v1");
    assert.match(context.bundle.cardSelection.reasons.sealed, /^diagnostic:/);
    assert.match(context.bundle.cardSelection.reasons.opening, /^neighbour: shares tag:onWatch/);
  });

  it("ranks targets, then diagnostics, then neighbours before the rest when the budget is tight", () => {
    const cards = [
      ...fillerDeck(6),
      card("producer", { left: { tags: { harborClosed: true } } }),
      card("consumer", { requirements: { allTags: ["harborClosed"] } }),
      card("selected")
    ];
    const diagnostics = { warnings: [{ code: "never_visited_cards", severity: "error", details: { cardIds: ["consumer"] } }] };
    const wantedBytes = cards.slice(6).reduce((total, entry) => total + JSON.stringify(entry).length, 0);
    const selection = selectAiContextCards({ cards, targetCardIds: ["selected"], diagnostics, budgetBytes: wantedBytes + 10 });

    assert.deepEqual(selection.cards.map((entry) => entry.id), ["producer", "consumer", "selected"]);
    assert.equal(selection.report.tiers.target, 1);
    assert.equal(selection.report.tiers.diagnostic, 1);
    assert.equal(selection.report.tiers.neighbour, 1);
    assert.equal(selection.report.omitted, 6);
    assert.ok(selection.report.usedBytes <= selection.report.budgetBytes);
  });

  it("respects the card-count limit and keeps authored order", () => {
    const cards = fillerDeck(60);
    const selection = selectAiContextCards({ cards, maxCards: 40 });
    assert.equal(selection.cards.length, 40);
    assert.deepEqual(selection.cards.map((entry) => entry.id), cards.slice(0, 40).map((entry) => entry.id));
    assert.equal(selection.report.omitted, 20);
  });

  it("always keeps the first target card even when it alone exceeds the budget", () => {
    const huge = card("huge", { text: "x".repeat(4000) });
    const selection = selectAiContextCards({ cards: [...fillerDeck(3), huge], targetCardIds: ["huge"], budgetBytes: 100 });
    assert.deepEqual(selection.cards.map((entry) => entry.id), ["huge"]);
  });

  it("treats every card that moves an issue gauge as relevant for gauge-pressure warnings", () => {
    const cards = [
      ...fillerDeck(3),
      card("pressure", { left: { factions: { gauge3: -12 } } })
    ];
    const diagnostics = { warnings: [{ code: "dominant_game_over_faction", severity: "warning", details: { faction: "gauge3" } }] };
    const selection = selectAiContextCards({ cards, diagnostics, maxCards: 1 });
    assert.deepEqual(selection.cards.map((entry) => entry.id), ["pressure"]);
  });

  it("uses repair-loop focus targets from request constraints", () => {
    const cards = [...fillerDeck(20), card("focus")];
    const request = buildCardEditRequest({
      bundle: { cards },
      constraints: { repairLoop: { targets: [{ code: "unreachable_cards", cardIds: ["focus"] }] } },
      contextStrategy: "relevance"
    });
    assert.match(request.context.bundle.cardSelection.reasons.focus, /^target: repair target/);
  });

  it("keeps the original first-12 context for drafting and other non-repair modes", () => {
    const cards = [...fillerDeck(20), card("late")];
    const diagnostics = { warnings: [{ code: "unreachable_cards", severity: "error", details: { cardIds: ["late"] } }] };
    for (const mode of ["generate_cards", "generate_asset", "analyze_asset"]) {
      const context = buildAiContext({ bundle: { cards }, diagnostics, mode });
      assert.equal(context.bundle.cards.length, 12, mode);
      assert.deepEqual(context.bundle.cards.map((entry) => entry.id), cards.slice(0, 12).map((entry) => entry.id));
      assert.equal(context.bundle.cardSelection.strategy, "first_n");
    }
    const drafting = createAiEditSuggestions({ bundle: { cards }, mode: "generate_cards", instruction: "Draft" });
    assert.equal(drafting.request.context.bundle.cards.length, 12);
    const repair = createAiEditSuggestions({ bundle: { cards }, mode: "repair_diagnostics", diagnostics });
    assert.equal(repair.request.context.bundle.cardSelection.strategy, "relevance_v1");
    assert.ok(repair.request.context.bundle.cards.some((entry) => entry.id === "late"));
  });

  it("collects required and produced signals per card", () => {
    const signals = collectAiCardSignals(card("x", {
      requirements: { allTags: ["a"], noneTags: ["b"], variables: { v: 1 }, factions: { gauge2: { min: 10 } } },
      left: { tags: { c: true, d: false }, variables: { w: "on" } }
    }));
    assert.deepEqual([...signals.requires.tags].sort(), ["a", "b"]);
    assert.deepEqual([...signals.requires.variables], ["v"]);
    assert.deepEqual([...signals.requires.factions], ["gauge2"]);
    assert.deepEqual([...signals.produces.tags], ["c"]);
    assert.deepEqual([...signals.produces.variables], ["w"]);
  });
});
