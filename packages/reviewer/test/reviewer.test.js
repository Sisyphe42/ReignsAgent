import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeCardGraph, runMonteCarloReview } from "../src/index.js";

describe("ReignsAgent reviewer", () => {
  it("runs deterministic headless Monte Carlo cycles and returns JSON diagnostics", () => {
    const report = runMonteCarloReview({
      cards: sampleCards(),
      cycles: 10,
      maxTurns: 4,
      seed: 7,
      choose: ({ card }) => card.choices[0]
    });

    assert.equal(report.module, "ReignsAgent-Reviewer");
    assert.deepEqual(report.parameters, { cycles: 10, maxTurns: 4, seed: 7 });
    assert.equal(report.summary.averageTurns, 3);
    assert.equal(report.summary.minTurns, 3);
    assert.equal(report.summary.maxTurns, 3);
    assert.deepEqual(report.summary.turnPercentiles, { p10: 3, p50: 3, p90: 3 });
    assert.equal(report.summary.gameOverRate, 1);
    assert.equal(report.summary.gameOverByFaction.people, 10);
    assert.equal(report.summary.terminalReasons["game_over:people"], 10);
    assert.equal(report.coverage.cardVisitRates.opening, 1);
    assert.equal(report.coverage.cardVisitRates.unrest, 1);
    assert.equal(report.coverage.cardVisitRates.crackdown, 1);
    assert.equal(report.diagnostics.warnings.at(-1).code, "dominant_game_over_faction");
    assert.doesNotThrow(() => JSON.stringify(report));
  });

  it("analyzes tag-gated card graph reachability", () => {
    const graph = analyzeCardGraph(sampleCards());

    assert.deepEqual(graph.edges, [
      { from: "opening", to: "unrest", tags: ["unrest"] },
      { from: "unrest", to: "crackdown", tags: ["armed"] }
    ]);
    assert.deepEqual(graph.unsatisfiedRequiredTags, []);
    assert.deepEqual(graph.unsatisfiedRequiredVariables, []);
  });

  it("analyzes variable-gated graph reachability", () => {
    const graph = analyzeCardGraph([
      {
        id: "setup",
        choices: [{ id: "set", effects: { variables: { decreeSigned: true } } }]
      },
      {
        id: "followup",
        requirements: { variables: { decreeSigned: true } },
        choices: [{ id: "pass", effects: {} }]
      }
    ]);

    assert.deepEqual(graph.edges, [{ from: "setup", to: "followup", variables: ["decreeSigned"] }]);
    assert.deepEqual(graph.unsatisfiedRequiredVariables, []);
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
    assert.equal(report.diagnostics.warnings[1].code, "unsatisfied_required_tags");
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
