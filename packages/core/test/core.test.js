import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createInitialState, createRuntime, getEligibleCards } from "../src/index.js";

describe("ReignsAgent core runtime", () => {
  it("creates a headless state with four bounded factions", () => {
    const state = createInitialState({ factions: { faith: 20, people: 80, military: 120 } });

    assert.deepEqual(state.factions, {
      faith: 20,
      people: 80,
      military: 100,
      treasury: 50
    });
    assert.equal(state.gameOver.faction, "military");
  });

  it("draws eligible cards without UI or IO concerns", () => {
    const cards = [
      card("open", {}, "accept"),
      card("locked", { allTags: ["crown"] }, "accept")
    ];
    const runtime = createRuntime({ cards, rng: () => 0 });

    assert.equal(runtime.draw().id, "open");
    assert.deepEqual(getEligibleCards(cards, runtime.state).map((candidate) => candidate.id), ["open"]);
  });

  it("loops the scheduler after all currently eligible cards have been dismissed", () => {
    const runtime = createRuntime({
      cards: [card("repeatable", {}, "pass")],
      rng: () => 0
    });

    assert.equal(runtime.draw().id, "repeatable");
    assert.equal(runtime.choose("pass").nextCard.id, "repeatable");
    assert.equal(runtime.state.turn, 1);
  });

  it("applies choice effects, advances turns, and detects game over", () => {
    const runtime = createRuntime({
      cards: [
        card("tax", {}, "raise", {
          factions: { people: -60, treasury: 20 },
          tags: { taxed: true }
        })
      ],
      state: { factions: { people: 50, treasury: 70 } },
      rng: () => 0
    });

    runtime.draw();
    const result = runtime.choose("raise");

    assert.equal(result.state.turn, 1);
    assert.equal(result.state.factions.people, 0);
    assert.equal(result.state.factions.treasury, 90);
    assert.equal(result.state.tags.taxed, true);
    assert.deepEqual(result.gameOver, {
      reason: "faction_bounds",
      faction: "people",
      value: 0
    });
  });

  it("models customization through low-level variables, tags, and hooks only", () => {
    const favorHook = {
      id: "court-favor",
      tags: ["favored"],
      hooks: {
        on_acquire({ adjustCardWeight, setVariable }) {
          adjustCardWeight("petition", 10);
          setVariable("favorDepth", 1);
        },
        on_tick({ scaleFaction }) {
          scaleFaction("people", 0.5);
        },
        on_dismiss({ clearTag }) {
          clearTag("favor-active");
        }
      }
    };
    const cards = [
      card("routine", {}, "ignore"),
      card("petition", { allTags: ["favored"] }, "grant", { factions: { people: 20 } })
    ];
    const runtime = createRuntime({ cards, rng: () => 0.5 });

    runtime.activateHook(favorHook);
    assert.equal(runtime.state.tags.favored, true);
    assert.equal(runtime.state.variables.favorDepth, 1);
    assert.equal(runtime.draw().id, "petition");

    runtime.choose("grant");
    assert.equal(runtime.state.factions.people, 70);
    assert.equal(runtime.state.factionScales.people, 0.5);

    runtime.dismissHook("court-favor");
    assert.equal(runtime.state.tags.favored, undefined);
  });
});

function card(id, requirements, choiceId, effects = {}) {
  return {
    id,
    text: id,
    requirements,
    choices: [
      {
        id: choiceId,
        label: choiceId,
        effects
      }
    ]
  };
}
