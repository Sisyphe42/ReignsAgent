import { readFileSync } from "node:fs";

/**
 * Offline repair-loop eval cases.
 *
 * Each case is a broken deck plus a scripted "model": one response per round
 * (a proposal list, or an HTTP failure). The script is fixed, so these cases
 * measure the harness (does the loop accept real fixes, block shortcuts, stop
 * and fall back correctly), not the quality of any real model.
 *
 * `expect` is the outcome a correct harness must produce.
 */

const FIXTURES = new URL("../../fixtures/content/", import.meta.url);

function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`${name}.cards.json`, FIXTURES), "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function card(id, { text, requirements = {}, left, right }) {
  return {
    id,
    text,
    weight: 1,
    requirements,
    choices: [
      { id: "left", label: left.label, effects: left.effects },
      { id: "right", label: right.label, effects: right.effects }
    ]
  };
}

// Fog Harbor workbench deck: the player deck plus a card gated on a tag nothing produces.
function fogHarborSealedWarehouse() {
  const bundle = loadFixture("fog-harbor");
  bundle.cards.push(card("sealed-warehouse", {
    text: "The quarantine is lifted. Warehouse seven, sealed for three months, can finally open.",
    requirements: { allTags: ["onWatch", "quarantineLifted"] },
    left: { label: "Send the doctor in first", effects: { factions: { gauge3: 5, gauge0: -5 }, tags: { warehouseChecked: true } } },
    right: { label: "Unload at once", effects: { factions: { gauge0: 9, gauge1: -6 }, tags: { warehouseOpened: true } } }
  }));
  return bundle;
}

// Court deck plus a card gated on a variable nothing sets.
function courtTollVariable() {
  const bundle = loadFixture("oss-court");
  bundle.cards.push(card("toll-dispute", {
    text: "The river toll is paid at last, and the ferrymen want it back.",
    requirements: { variables: { riverToll: "paid" } },
    left: { label: "Refund them", effects: { factions: { gauge1: 4, gauge3: -5 } } },
    right: { label: "Keep the toll", effects: { factions: { gauge3: 5, gauge1: -4 } } }
  }));
  return bundle;
}

// Four one-shot cards and nothing repeatable: every run stalls after four turns.
function nightWatchStall() {
  const oneShot = (id, text, tag, left, right) => card(id, {
    text,
    requirements: { noneTags: [tag] },
    left: { label: left[0], effects: { factions: left[1], tags: { [tag]: true } } },
    right: { label: right[0], effects: { factions: right[1], tags: { [tag]: true } } }
  });
  return {
    metadata: { title: "Night Watch", version: "0.0.1" },
    cards: [
      oneShot("bell-tower", "The bell tower is unmanned tonight.", "bellDone", ["Ring it yourself", { gauge0: 3, gauge2: -2 }], ["Leave it", { gauge2: 2, gauge0: -3 }]),
      oneShot("gate-key", "The gate key is missing.", "keyDone", ["Change the locks", { gauge3: -4, gauge2: 3 }], ["Search quietly", { gauge1: 2, gauge2: -2 }]),
      oneShot("lantern-oil", "The lantern oil will not last the night.", "oilDone", ["Buy more", { gauge3: -3, gauge1: 2 }], ["Ration it", { gauge1: -3, gauge3: 2 }]),
      oneShot("drunk-guard", "A guard is asleep at his post.", "guardDone", ["Wake him", { gauge2: 2, gauge1: -2 }], ["Cover for him", { gauge1: 3, gauge2: -3 }])
    ]
  };
}

const QUARANTINE_BOARD = {
  op: "addCard",
  card: card("quarantine-board", {
    text: "The health board asks whether the quarantine can end.",
    requirements: { allTags: ["onWatch"] },
    left: { label: "Lift it", effects: { factions: { gauge1: 4, gauge0: -3 }, tags: { quarantineLifted: true } } },
    right: { label: "Keep it", effects: { factions: { gauge0: 3, gauge1: -4 } } }
  })
};

const fog = {
  wipeGate: { id: "wipe-gate", title: "Open the warehouse", summary: "Clear the warehouse requirements.", patches: [{ op: "updateCard", cardId: "sealed-warehouse", changes: { requirements: {} } }] },
  addProducer: { id: "quarantine-board", title: "Add a quarantine decision", summary: "A health-board card can lift the quarantine.", patches: [QUARANTINE_BOARD] },
  rename: { id: "rename-card", title: "Replace the warehouse card", summary: "Rename the card.", patches: [{ op: "updateCard", cardId: "sealed-warehouse", changes: { id: "warehouse-seven" } }] },
  zeroEffects: {
    id: "fold-into-first-fog",
    title: "Lift quarantine on the first night",
    summary: "Make first-fog produce the tag.",
    patches: [{ op: "setChoiceEffects", cardId: "first-fog", choiceId: "left", effects: { tags: { onWatch: true, lampAllNight: true, quarantineLifted: true } } }]
  },
  offScope: {
    id: "producer-plus-rewrite",
    title: "Producer plus an audit rewrite",
    summary: "Adds the producer and rewrites an unrelated card.",
    patches: [QUARANTINE_BOARD, { op: "updateCard", cardId: "council-audit", changes: { text: "The council audits the harbor books again." } }]
  },
  newError: {
    id: "producer-plus-dead-end",
    title: "Producer plus a follow-up",
    summary: "Adds the producer and a follow-up gated on a tag nothing sets.",
    patches: [QUARANTINE_BOARD, { op: "addCard", card: { ...clone(QUARANTINE_BOARD.card), id: "quarantine-riot", requirements: { allTags: ["riotStarted"] } } }]
  },
  leftOnly: {
    id: "one-sided-board",
    title: "One-sided health board",
    summary: "Producer card with a single choice.",
    patches: [{ op: "addCard", card: { ...clone(QUARANTINE_BOARD.card), choices: [clone(QUARANTINE_BOARD.card.choices[0])] } }]
  },
  missingCard: { id: "ghost-edit", title: "Edit a card that does not exist", summary: "Targets an unknown card.", patches: [{ op: "updateCard", cardId: "warehouse-eight", changes: { text: "x" } }] }
};

function courtEffects(bundle, cardId, choiceId) {
  return clone(bundle.cards.find((entry) => entry.id === cardId).choices.find((choice) => choice.id === choiceId).effects);
}

function courtGauge1(cardId, choiceId, value) {
  const effects = courtEffects(loadFixture("oss-court"), cardId, choiceId);
  effects.factions = { ...effects.factions, gauge1: value };
  return { op: "setChoiceEffects", cardId, choiceId, effects };
}

function courtStripGauge1(cardId, choiceId) {
  const effects = courtEffects(loadFixture("oss-court"), cardId, choiceId);
  delete effects.factions.gauge1;
  return { op: "setChoiceEffects", cardId, choiceId, effects };
}

const TOLL_PRODUCER = {
  op: "addCard",
  card: card("ferry-charter", {
    text: "The ferrymen offer a charter: a river toll in exchange for a guarded crossing.",
    left: { label: "Sign the charter", effects: { factions: { gauge3: 4, gauge1: -3 }, variables: { riverToll: "paid" } } },
    right: { label: "Refuse", effects: { factions: { gauge1: 3, gauge3: -3 } } }
  })
};

// Cases marked `real` are also run against a real endpoint (`--real`): the model gets
// only the broken deck and the target issue, never the scripted answers.
export const REPAIR_EVAL_CASES = [
  {
    id: "fog-direct-fix",
    description: "Fog Harbor sealed-warehouse: the first answer adds a producer card.",
    deck: fogHarborSealedWarehouse,
    repairTarget: { code: "unreachable_cards", cardIds: ["sealed-warehouse"] },
    script: [[fog.addProducer]],
    expect: { status: "verified", rounds: 1, blocked: {} },
    real: { taskId: "fog-unreachable" }
  },
  {
    id: "fog-gate-wipe-then-fix",
    description: "Round 1 wipes the warehouse gate (scores well, blocked); round 2 adds a producer.",
    deck: fogHarborSealedWarehouse,
    repairTarget: { code: "unreachable_cards", cardIds: ["sealed-warehouse"] },
    script: [[fog.wipeGate], [fog.addProducer]],
    expect: { status: "verified", rounds: 2, blocked: { gates_preserved: 1 } },
    realSkip: "Same deck and target as fog-direct-fix; the real run covers it once."
  },
  {
    id: "fog-rename-zero-then-fix",
    description: "Round 1 renames the card away; round 2 strips first-fog gauge effects; round 3 adds a producer.",
    deck: fogHarborSealedWarehouse,
    repairTarget: { code: "unsatisfied_required_tags", entities: ["tag:quarantineLifted"] },
    script: [[fog.rename], [fog.zeroEffects], [fog.addProducer]],
    expect: { status: "verified", rounds: 3, blocked: { card_ids_preserved: 1, target_resolved: 1, effects_preserved: 1 } },
    real: { taskId: "fog-missing-tag" }
  },
  {
    id: "fog-persistent-shortcuts",
    description: "Three rounds of shortcuts: gate wipe and a stray edit, a new dead-end card, a one-sided card.",
    deck: fogHarborSealedWarehouse,
    repairTarget: { code: "unreachable_cards", cardIds: ["sealed-warehouse"] },
    script: [[fog.wipeGate, fog.offScope], [fog.newError], [fog.leftOnly]],
    expect: { status: "unverified", rounds: 3, stopReason: "max_rounds", blocked: { gates_preserved: 1, scope: 1, no_new_errors: 1, player_valid: 1 } },
    realSkip: "Same deck and target as fog-direct-fix; only the scripted shortcuts differ."
  },
  {
    id: "fog-rejected-response",
    description: "Round 1 patches a card that does not exist (prevalidation rejects the response); round 2 fixes it.",
    deck: fogHarborSealedWarehouse,
    repairTarget: { code: "unreachable_cards", cardIds: ["sealed-warehouse"] },
    script: [[fog.missingCard], [fog.addProducer]],
    expect: { status: "verified", rounds: 2, rejectedRounds: 1, blocked: {} },
    realSkip: "Scripted malformed response (failure injection); a real model is not asked to fail."
  },
  {
    id: "fog-endpoint-drop",
    description: "Round 1 wipes the gate; the endpoint returns HTTP 503 in round 2. Best earlier round is returned, unverified.",
    deck: fogHarborSealedWarehouse,
    repairTarget: { code: "unreachable_cards", cardIds: ["sealed-warehouse"] },
    script: [[fog.wipeGate], { status: 503, body: { error: "upstream unavailable" } }],
    expect: { status: "unverified", rounds: 2, stopReason: "endpoint_error", blocked: { gates_preserved: 1 } },
    realSkip: "Scripted HTTP 503 (endpoint failure injection)."
  },
  {
    id: "court-gauge-pressure",
    description: "OSS Court gauge1 dominates endings (overflow). Round 1 softens the wrong side, round 2 strips gauge1 from six choices, round 3 halves the largest push.",
    deck: () => loadFixture("oss-court"),
    repairTarget: { code: "dominant_game_over_faction", entities: ["gauge:gauge1"] },
    script: [
      [{ id: "soften-penalties", title: "Soften gauge1 penalties", summary: "Reduce negative gauge1 deltas.", patches: [courtGauge1("unrest-court", "right", -3), courtGauge1("granary-count", "right", -2)] }],
      [{
        id: "strip-gauge1",
        title: "Remove gauge1 from busy choices",
        summary: "Strip gauge1 from six choices.",
        patches: [["granary-count", "left"], ["gate-audience", "left"], ["unrest-court", "left"], ["treasury-count", "left"], ["token-riot", "left"], ["harvest-court", "left"]].map(([cardId, choiceId]) => courtStripGauge1(cardId, choiceId))
      }],
      [{ id: "halve-granary", title: "Halve the granary relief push", summary: "granary-count left gauge1 8 → 4.", patches: [courtGauge1("granary-count", "left", 4)] }]
    ],
    expect: { status: "verified", rounds: 3, blocked: { target_resolved: 1, score_not_lower: 1, scope: 1 } },
    real: { taskId: "court-gauge-pressure" }
  },
  {
    id: "court-variable-gate",
    description: "A court card needs riverToll = paid and nothing sets it. Round 1 adds a one-sided producer; round 2 a proper card.",
    deck: courtTollVariable,
    repairTarget: { code: "unsatisfied_required_variables", entities: ["var:riverToll"] },
    script: [
      [{ id: "one-sided-charter", title: "Ferry charter", summary: "Producer with one choice.", patches: [{ op: "addCard", card: { ...clone(TOLL_PRODUCER.card), choices: [clone(TOLL_PRODUCER.card.choices[0])] } }] }],
      [{ id: "ferry-charter", title: "Ferry charter", summary: "A charter card sets the toll.", patches: [TOLL_PRODUCER] }]
    ],
    expect: { status: "verified", rounds: 2, blocked: { player_valid: 1 } },
    real: { taskId: "court-variable-gate" }
  },
  {
    id: "court-variable-market-producer",
    description: "Answer the real model gave in all three first rounds of the 2026-11-24 run: add riverToll to both river-market choices (an existing card outside the related set). Producer-only edits are scope-exempt since phase 3.",
    deck: courtTollVariable,
    repairTarget: { code: "unsatisfied_required_variables", entities: ["var:riverToll"] },
    script: [[{
      id: "river-market-toll",
      title: "Seed riverToll through the river market",
      summary: "Adds riverToll=paid to both river-market outcomes while preserving each choice's existing tags and full gauge movement.",
      patches: ["left", "right"].map((choiceId) => {
        const effects = courtEffects(loadFixture("oss-court"), "river-market", choiceId);
        return { op: "setChoiceEffects", cardId: "river-market", choiceId, effects: { ...effects, variables: { ...(effects.variables ?? {}), riverToll: "paid" } } };
      })
    }]],
    expect: { status: "verified", rounds: 1, blocked: {} },
    realSkip: "Replays a recorded real-model answer; the real run covers court-variable-gate."
  },
  {
    id: "night-watch-stall",
    description: "Four one-shot cards stall every run. Round 1 removes the one-shot gates; round 2 adds a repeatable patrol card.",
    deck: nightWatchStall,
    repairTarget: { code: "stalled_cycles" },
    script: [
      [{
        id: "remove-one-shot-gates",
        title: "Let every card repeat",
        summary: "Drop the noneTags gates.",
        patches: ["bell-tower", "gate-key", "lantern-oil", "drunk-guard"].map((cardId) => ({ op: "updateCard", cardId, changes: { requirements: {} } }))
      }],
      [{
        id: "routine-patrol",
        title: "Add a routine patrol",
        summary: "A repeatable card keeps the night moving.",
        patches: [{
          op: "addCard",
          card: card("routine-patrol", {
            text: "The patrol reports another quiet street.",
            left: { label: "Double the round", effects: { factions: { gauge2: 2, gauge3: -2 } } },
            right: { label: "Send them home", effects: { factions: { gauge3: 2, gauge2: -2 } } }
          })
        }]
      }]
    ],
    expect: { status: "verified", rounds: 2, blocked: { gates_preserved: 1 } },
    real: { taskId: "night-watch-stall" }
  }
];

// Checks that exist to stop shortcut fixes (as opposed to "did it fix the issue").
export const ANTI_SHORTCUT_CHECKS = new Set([
  "gates_preserved",
  "effects_preserved",
  "card_ids_preserved",
  "scope",
  "no_new_errors",
  "reachability_kept",
  "player_valid",
  "allowed_ops"
]);
