import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { runMonteCarloReview, runMonteCarloReviewAsync } from "../src/index.js";

const FOG = JSON.parse(readFileSync(new URL("../../../fixtures/content/fog-harbor.cards.json", import.meta.url), "utf8"));

describe("reviewer progress", () => {
  it("reports monotonic completed/total progress ending at the cycle count", () => {
    const events = [];
    runMonteCarloReview({ cards: FOG.cards, cycles: 230, maxTurns: 20, seed: 3, onProgress: (event) => events.push(event) });
    assert.deepEqual(events.map((event) => event.completed), [50, 100, 150, 200, 230]);
    assert.ok(events.every((event) => event.total === 230));
  });

  it("produces exactly the same report when run in yielding chunks", async () => {
    const options = { cards: FOG.cards, cycles: 300, maxTurns: 30, seed: 5 };
    const sync = runMonteCarloReview(options);
    let yields = 0;
    const events = [];
    const chunked = await runMonteCarloReviewAsync({
      ...options,
      chunkCycles: 64,
      yieldToHost: async () => { yields += 1; },
      onProgress: (event) => events.push(event)
    });
    assert.deepEqual(chunked, sync);
    assert.equal(yields, 4, "300 cycles in chunks of 64 yield between the 5 chunks");
    assert.equal(events.at(-1).completed, 300);
  });

  it("falls back to the default chunk size for non-numeric or non-positive chunkCycles", async () => {
    const options = { cards: FOG.cards, cycles: 120, maxTurns: 20, seed: 4 };
    const expected = runMonteCarloReview(options);
    for (const chunkCycles of [Number.NaN, "fast", 0, -5, Infinity]) {
      let yields = 0;
      const report = await runMonteCarloReviewAsync({ ...options, chunkCycles, yieldToHost: async () => { yields += 1; if (yields > 50) throw new Error("did not advance"); } });
      assert.deepEqual(report, expected, `chunkCycles ${String(chunkCycles)}`);
    }
  });

  it("never lets the progress option leak into the report parameters", () => {
    const report = runMonteCarloReview({ cards: FOG.cards, cycles: 10, maxTurns: 5, seed: 1, onProgress: () => {} });
    assert.equal(Object.hasOwn(report.parameters, "onProgress"), false);
  });
});
