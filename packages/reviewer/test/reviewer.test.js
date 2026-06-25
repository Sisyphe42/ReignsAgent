import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ReviewerError, analyzeCardGraph, runMonteCarloReview, runSimulationCycle } from "../src/index.js";

describe("ReignsAgent reviewer", () => {
  it("runs deterministic headless Monte Carlo cycles and returns JSON diagnostics", () => {
    const report = runMonteCarloReview({
      cards: sampleCards(),
      cycles: 10,
      maxTurns: 4,
      seed: 7,
      sampleLimit: 2,
      choose: ({ card }) => card.choices[0]
    });

    assert.equal(report.module, "ReignsAgent-Reviewer");
    assert.deepEqual(report.parameters, {
      cycles: 10,
      maxTurns: 4,
      seed: 7,
      sampleLimit: 2,
      includeSampleEvents: false
    });
    assert.equal(report.summary.averageTurns, 3);
    assert.equal(report.summary.minTurns, 3);
    assert.equal(report.summary.maxTurns, 3);
    assert.deepEqual(report.summary.turnPercentiles, { p10: 3, p50: 3, p90: 3 });
    assert.equal(report.summary.gameOverRate, 1);
    assert.equal(report.summary.terminalReasonRates["game_over:people"], 1);
    assert.equal(report.summary.gameOverByFaction.people, 10);
    assert.equal(report.summary.terminalReasons["game_over:people"], 10);
    assert.equal(report.coverage.cardVisitRates.opening, 1);
    assert.equal(report.coverage.cardCycleRates.opening, 1);
    assert.equal(report.coverage.cardVisitRates.unrest, 1);
    assert.equal(report.coverage.cardVisitRates.crackdown, 1);
    assert.equal(report.samples.length, 2);
    assert.equal(report.samples[0].seed, 7);
    assert.equal(report.diagnostics.warnings.at(-1).code, "dominant_game_over_faction");
    assert.equal(report.diagnostics.warnings.at(-1).severity, "warning");
    assert.doesNotThrow(() => JSON.stringify(report));
  });

  it("runs a single deterministic simulation cycle with optional event samples", () => {
    const result = runSimulationCycle({
      cards: sampleCards(),
      maxTurns: 4,
      seed: 5,
      includeEvents: true,
      choose: ({ card }) => card.choices[0].id
    });

    assert.equal(result.schemaVersion, 1);
    assert.equal(result.seed, 5);
    assert.equal(result.turns, 3);
    assert.equal(result.terminalReason, "game_over:people");
    assert.deepEqual(result.cardVisits, { opening: 1, unrest: 1, crackdown: 1 });
    assert.deepEqual(result.choiceVisits, {
      "opening:tax": 1,
      "unrest:arm": 1,
      "crackdown:order": 1
    });
    assert.equal(result.events[0].type, "draw");
    assert.equal(result.events.at(-1).type, "game_over");
  });

  it("includes bounded cycle samples with runtime events when requested", () => {
    const report = runMonteCarloReview({
      cards: sampleCards(),
      cycles: 3,
      maxTurns: 4,
      seed: 1,
      sampleLimit: 1,
      includeSampleEvents: true,
      choose: ({ card }) => card.choices[0]
    });

    assert.equal(report.samples.length, 1);
    assert.ok(Array.isArray(report.samples[0].events));
    assert.equal(report.samples[0].events[0].type, "draw");
  });

  it("analyzes tag-gated card graph reachability", () => {
    const graph = analyzeCardGraph(sampleCards());

    assert.deepEqual(graph.edges, [
      { from: "opening", to: "unrest", tags: ["unrest"], choices: [{ id: "tax", label: "tax" }] },
      { from: "unrest", to: "crackdown", tags: ["armed"], choices: [{ id: "arm", label: "arm" }] }
    ]);
    assert.deepEqual(graph.initiallyEligibleCards, ["opening"]);
    assert.deepEqual(graph.reachableCards, ["opening", "unrest", "crackdown"]);
    assert.deepEqual(graph.unreachableCards, []);
    assert.deepEqual(graph.unsatisfiedRequiredTags, []);
    assert.deepEqual(graph.unsatisfiedRequiredVariables, []);
  });

  it("analyzes exact variable-gated graph reachability", () => {
    const graph = analyzeCardGraph([
      {
        id: "setup",
        choices: [{ id: "set", effects: { variables: { decreeSigned: true } } }]
      },
      {
        id: "followup",
        requirements: { variables: { decreeSigned: true } },
        choices: [{ id: "pass", effects: {} }]
      },
      {
        id: "wrong-value",
        requirements: { variables: { decreeSigned: false } },
        choices: [{ id: "pass", effects: {} }]
      }
    ]);

    assert.deepEqual(graph.edges, [
      { from: "setup", to: "followup", variables: ["decreeSigned"], choices: [{ id: "set", label: "set" }] }
    ]);
    assert.deepEqual(graph.reachableCards, ["setup", "followup"]);
    assert.deepEqual(graph.unreachableCards, ["wrong-value"]);
    assert.deepEqual(graph.unsatisfiedRequiredVariables, ["decreeSigned"]);
  });

  it("attributes enabling signals to specific choices and preserves labels", () => {
    const graph = analyzeCardGraph([
      {
        id: "fork",
        choices: [
          { id: "left", label: "Raise tax", effects: { tags: { taxed: true } } },
          { id: "right", label: "Pardon debt", effects: { tags: { taxed: true } } }
        ]
      },
      {
        id: "consequence",
        requirements: { allTags: ["taxed"] },
        choices: [{ id: "pass", label: "Accept", effects: {} }]
      }
    ]);

    // Both left and right produce the `taxed` tag, so both choices enable the edge.
    assert.deepEqual(graph.edges, [
      {
        from: "fork",
        to: "consequence",
        tags: ["taxed"],
        choices: [
          { id: "left", label: "Raise tax" },
          { id: "right", label: "Pardon debt" }
        ]
      }
    ]);
  });

  it("reports unreachable requirements as diagnostics", () => {
    const report = runMonteCarloReview({
      cards: [
        {
          id: "visible",
          choices: [{ id: "pass", effects: {} }]
        },
        {
          id: "hidden",
          requirements: { allTags: ["missing"] },
          choices: [{ id: "pass", effects: {} }]
        }
      ],
      cycles: 2,
      maxTurns: 2,
      seed: 1
    });

    assert.deepEqual(report.graph.unsatisfiedRequiredTags, ["missing"]);
    assert.equal(report.diagnostics.warnings[0].code, "never_visited_cards");
    assert.equal(report.diagnostics.warnings.find((warning) => warning.code === "unsatisfied_required_tags").severity, "error");
    assert.equal(report.diagnostics.warnings.find((warning) => warning.code === "unreachable_cards").severity, "error");
  });

  it("reports unsatisfied variable requirements as diagnostics", () => {
    const report = runMonteCarloReview({
      cards: [
        {
          id: "visible",
          choices: [{ id: "pass", effects: {} }]
        },
        {
          id: "hidden",
          requirements: { variables: { missingVariable: true } },
          choices: [{ id: "pass", effects: {} }]
        }
      ],
      cycles: 2,
      maxTurns: 2,
      seed: 1
    });

    assert.deepEqual(report.graph.unsatisfiedRequiredVariables, ["missingVariable"]);
    assert.equal(
      report.diagnostics.warnings.find((warning) => warning.code === "unsatisfied_required_variables").variables[0],
      "missingVariable"
    );
  });

  it("applies configurable thresholds for coverage and ending warnings", () => {
    const report = runMonteCarloReview({
      cards: sampleCards(),
      cycles: 10,
      maxTurns: 4,
      seed: 7,
      choose: ({ card }) => card.choices[0],
      thresholds: {
        highGameOverRate: 1,
        dominantGameOverRate: 1,
        lowCardCycleRate: 0.5
      }
    });

    assert.equal(report.thresholds.highGameOverRate, 1);
    assert.equal(report.diagnostics.warnings.some((warning) => warning.code === "high_game_over_rate"), false);
    assert.equal(report.diagnostics.warnings.some((warning) => warning.code === "dominant_game_over_faction"), false);
  });

  it("rejects invalid reviewer configuration and invalid choices", () => {
    assert.throws(() => runMonteCarloReview({ cards: [], cycles: 0 }), ReviewerError);
    assert.throws(() => runMonteCarloReview({ cards: [], thresholds: { highGameOverRate: 2 } }), ReviewerError);
    assert.throws(
      () =>
        runSimulationCycle({
          cards: [card("only", {}, "left")],
          choose: () => "right"
        }),
      /not valid/
    );
  });
});

function sampleCards() {
  return [
    {
      id: "opening",
      choices: [
        {
          id: "tax",
          effects: {
            factions: { people: -20, treasury: 10 },
            tags: { unrest: true }
          }
        }
      ]
    },
    {
      id: "unrest",
      requirements: { allTags: ["unrest"] },
      choices: [
        {
          id: "arm",
          effects: {
            factions: { people: -20, military: 10 },
            tags: { armed: true }
          }
        }
      ]
    },
    {
      id: "crackdown",
      requirements: { allTags: ["armed"] },
      choices: [
        {
          id: "order",
          effects: {
            factions: { people: -20, military: 10 }
          }
        }
      ]
    }
  ];
}

function card(id, requirements, choiceId, effects = {}) {
  return {
    id,
    requirements,
    choices: [
      {
        id: choiceId,
        effects
      }
    ]
  };
}
