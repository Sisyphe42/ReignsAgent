import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createInitialState,
  createRuntime,
  getEligibleCards,
  normalizeCards,
  restoreState,
  serializeState,
  validateCards
} from "../src/index.js";

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

  it("gates cards by combined tags, variables, and faction thresholds", () => {
    const cards = [
      card("grain-branch", {
        allTags: ["grainRelief"],
        variables: { openingPetition: "grain" },
        factions: { people: { min: 55 }, treasury: { max: 48 } }
      }, "accept"),
      card("border-branch", {
        allTags: ["borderAlert"],
        variables: { openingPetition: "border" },
        factions: { military: { min: 55 } }
      }, "accept")
    ];
    const grainState = createInitialState({
      tags: { grainRelief: true },
      variables: { openingPetition: "grain" },
      factions: { people: 56, treasury: 46 }
    });
    const lowSupportState = createInitialState({
      tags: { grainRelief: true },
      variables: { openingPetition: "grain" },
      factions: { people: 54, treasury: 46 }
    });

    assert.deepEqual(getEligibleCards(cards, grainState).map((candidate) => candidate.id), ["grain-branch"]);
    assert.deepEqual(getEligibleCards(cards, lowSupportState).map((candidate) => candidate.id), []);
    assert.throws(
      () => normalizeCards([card("bad", { factions: { mana: { min: 1 } } }, "accept")]),
      /Unknown faction/
    );
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
      data: { scale: 0.5 },
      hooks: {
        on_acquire({ adjustCardWeight, setVariable, data }) {
          adjustCardWeight("petition", 10);
          setVariable("favorDepth", data.scale);
        },
        on_tick({ scaleFaction, data }) {
          scaleFaction("people", data.scale);
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
    assert.equal(runtime.state.variables.favorDepth, 0.5);
    assert.equal(runtime.draw().id, "petition");

    runtime.choose("grant");
    assert.equal(runtime.state.factions.people, 70);
    assert.equal(runtime.state.factionScales.people, 0.5);

    runtime.dismissHook("court-favor");
    assert.equal(runtime.state.tags.favored, undefined);
  });

  it("validates card contracts before runtime play", () => {
    assert.throws(
      () =>
        normalizeCards([
          card("broken", {}, "bad", {
            factions: { unknown: 1 }
          })
        ]),
      /Unknown faction/
    );

    assert.deepEqual(validateCards([card("valid", {}, "pass")]), {
      valid: true,
      errors: []
    });
  });

  it("serializes JSON-safe snapshots and restores hook functions from a registry", () => {
    const cards = [card("repeatable", {}, "accept", { factions: { people: 10 } })];
    const runtime = createRuntime({ cards, rng: () => 0 });
    runtime.activateHook(scalingHook(0.5));

    const snapshot = runtime.snapshot();
    const parsedSnapshot = JSON.parse(JSON.stringify(snapshot));

    assert.equal(parsedSnapshot.schemaVersion, 1);
    assert.equal(parsedSnapshot.activeHooks[0].id, "scale-people");
    assert.equal(parsedSnapshot.activeHooks[0].requiresRegistry, true);
    assert.equal("hooks" in parsedSnapshot.activeHooks[0], false);
    assert.throws(() => restoreState(parsedSnapshot), /Missing hook registry entry/);

    const restoredState = restoreState(parsedSnapshot, {
      hookRegistry: {
        "scale-people": scalingHook(0.5).hooks
      }
    });
    const restoredRuntime = createRuntime({ cards, state: restoredState, rng: () => 0 });

    restoredRuntime.draw();
    restoredRuntime.choose("accept");
    assert.equal(restoredRuntime.state.factions.people, 60);
    assert.equal(restoredRuntime.state.factionScales.people, 0.5);
  });

  it("can restore snapshots without missing hook functions when explicitly allowed", () => {
    const cards = [card("repeatable", {}, "accept", { factions: { people: 10 } })];
    const runtime = createRuntime({ cards, rng: () => 0 });
    runtime.activateHook(scalingHook(0.5));

    const restoredState = restoreState(JSON.parse(JSON.stringify(runtime.snapshot())), {
      allowMissingHooks: true
    });
    const restoredRuntime = createRuntime({ cards, state: restoredState, rng: () => 0 });

    restoredRuntime.draw();
    restoredRuntime.choose("accept");
    assert.equal(restoredRuntime.state.factions.people, 60);
    assert.equal(restoredRuntime.state.factionScales.people, 1);
  });

  it("restores a snapshot and continues with the same draw and choice behavior", () => {
    const cards = [
      card("first", {}, "accept", { variables: { opened: true } }),
      card("second", { variables: { opened: true } }, "accept", { factions: { treasury: 5 } })
    ];
    const runtime = createRuntime({ cards, rng: () => 0 });

    runtime.draw();
    runtime.choose("accept");

    const restoredState = restoreState(serializeState(runtime.state));
    const restoredRuntime = createRuntime({ cards, state: restoredState, rng: () => 0 });

    assert.equal(restoredRuntime.state.turn, runtime.state.turn);
    assert.equal(restoredRuntime.draw().id, runtime.draw().id);
  });

  it("steps deterministically by drawing when needed and then applying a choice", () => {
    const runtime = createRuntime({
      cards: [card("start", {}, "accept", { variables: { accepted: true } })],
      rng: () => 0
    });

    const result = runtime.step("accept");

    assert.equal(result.event.type, "choice");
    assert.equal(result.event.cardId, "start");
    assert.equal(result.state.turn, 1);
    assert.equal(result.state.variables.accepted, true);
    assert.equal(result.nextCard.id, "start");
  });

  it("records JSON-safe runtime events for draw, choice, hooks, reset, stall, and ending", () => {
    const repeatRuntime = createRuntime({
      cards: [card("repeatable", {}, "pass")],
      rng: () => 0
    });
    repeatRuntime.activateHook({ id: "marker", tags: ["marked"], data: { source: "test" } });
    repeatRuntime.dismissHook("marker");
    repeatRuntime.draw();
    repeatRuntime.choose("pass");

    assert.deepEqual(
      repeatRuntime.events.map((event) => event.type),
      ["hook_activate", "hook_dismiss", "draw", "choice", "loop_reset", "draw"]
    );
    assert.doesNotThrow(() => JSON.stringify(repeatRuntime.events));

    const stalledRuntime = createRuntime({ cards: [] });
    assert.equal(stalledRuntime.draw(), null);
    assert.equal(stalledRuntime.events.at(-1).type, "stall");

    const endingRuntime = createRuntime({
      cards: [card("fall", {}, "accept", { factions: { people: -60 } })],
      state: { factions: { people: 50 } },
      rng: () => 0
    });
    endingRuntime.draw();
    endingRuntime.choose("accept");

    assert.equal(endingRuntime.events.at(-1).type, "game_over");
    assert.equal(endingRuntime.events.at(-1).faction, "people");
  });

  it("rejects invalid hook contracts and bad snapshots", () => {
    assert.throws(
      () =>
        createRuntime({
          cards: [],
          state: {
            activeHooks: [{ id: "bad", hooks: { on_tick: "nope" } }]
          }
        }),
      /must be a function/
    );
    assert.throws(
      () =>
        createRuntime({
          cards: [],
          state: {
            activeHooks: [{ id: "bad", hooks: { on_unknown() {} } }]
          }
        }),
      /unknown hook/
    );
    assert.throws(() => restoreState({ schemaVersion: 999 }), /Unsupported snapshot schemaVersion/);
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

function scalingHook(scale) {
  return {
    id: "scale-people",
    tags: ["scaled"],
    data: { scale },
    hooks: {
      on_tick({ data, scaleFaction }) {
        scaleFaction("people", data.scale);
      }
    }
  };
}
