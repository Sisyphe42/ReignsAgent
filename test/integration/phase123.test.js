import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createRuntime } from "../../packages/core/src/index.js";
import { parseCardsJson, stringifyCardsCsv } from "../../packages/pipeline/src/index.js";
import { runMonteCarloReview } from "../../packages/reviewer/src/index.js";

describe("Phase 1-3 integration", () => {
  it("imports generated card data, plays it in core, and reviews it headlessly", () => {
    const cards = parseCardsJson({
      cards: [
        {
          id: "edict",
          text: "A new edict is ready.",
          choices: [
            {
              id: "sign",
              label: "Sign",
              effects: {
                factions: { people: -10, treasury: 10 },
                variables: { signedEdict: true },
                tags: { edictSigned: true }
              }
            }
          ]
        },
        {
          id: "reaction",
          text: "The court asks for restraint.",
          requirements: { variables: { signedEdict: true }, allTags: ["edictSigned"] },
          choices: [
            {
              id: "listen",
              label: "Listen",
              effects: { factions: { people: 5, treasury: -5 } }
            }
          ]
        }
      ]
    });

    const runtime = createRuntime({ cards, rng: () => 0 });
    assert.equal(runtime.draw().id, "edict");
    assert.equal(runtime.choose("sign").nextCard.id, "reaction");

    const report = runMonteCarloReview({ cards, cycles: 5, maxTurns: 2, seed: 3 });
    assert.equal(report.module, "ReignsAgent-Reviewer");
    assert.equal(report.coverage.cardVisitRates.edict, 1);
    assert.equal(report.coverage.cardVisitRates.reaction, 1);
    assert.match(stringifyCardsCsv(cards), /signedEdict/);
  });
});
