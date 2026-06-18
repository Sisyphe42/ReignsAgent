import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  buildCardGenerationPrompt,
  createDiagnosticFeedback,
  generateAssetDrafts,
  generateCardDrafts,
  parseCardsCsv,
  parseCardsJson,
  stringifyCardsCsv,
  writeCardsCsv,
  writeCardsJson
} from "../src/index.js";

describe("ReignsAgent pipeline", () => {
  it("round-trips cards through JSON and CSV without core simulation logic", () => {
    const cards = sampleCards();
    const fromJson = parseCardsJson(JSON.stringify({ cards }));
    const csv = stringifyCardsCsv(fromJson);
    const fromCsv = parseCardsCsv(csv);

    assert.deepEqual(fromCsv, fromJson);
    assert.match(csv, /cardId,text,weight,requirementsJson,choiceId,choiceLabel,effectsJson/);
  });

  it("writes local JSON and CSV artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reigns-agent-pipeline-"));

    try {
      const jsonPath = join(dir, "cards.json");
      const csvPath = join(dir, "cards.csv");

      await writeCardsJson(jsonPath, sampleCards());
      await writeCardsCsv(csvPath, sampleCards());

      assert.match(await readFile(jsonPath, "utf8"), /"cards"/);
      assert.match(await readFile(csvPath, "utf8"), /opening/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses connector boundaries for card and asset generation", async () => {
    const connector = {
      name: "stub",
      async generateText(request) {
        assert.equal(request.purpose, "card_generation");
        assert.match(request.prompt, /abstract tags or inventory entries only/);
        return JSON.stringify({ cards: sampleCards() });
      },
      async generateAsset(request) {
        return { cardId: request.cardId, prompt: request.prompt, uri: `memory://${request.cardId}` };
      }
    };

    const cards = await generateCardDrafts({
      connector,
      theme: "small kingdom",
      count: 1
    });
    const assets = await generateAssetDrafts({ connector, cards });

    assert.equal(cards[0].id, "opening");
    assert.deepEqual(
      assets.map((asset) => asset.uri),
      ["memory://opening"]
    );
  });

  it("turns reviewer diagnostics into generation feedback actions", () => {
    const feedback = createDiagnosticFeedback({
      module: "ReignsAgent-Reviewer",
      parameters: { cycles: 10 },
      summary: { gameOverByFaction: { people: 6, faith: 0 } },
      diagnostics: {
        warnings: [
          { code: "never_visited_cards", message: "unreached", cardIds: ["hidden"] },
          { code: "unsatisfied_required_tags", message: "missing tags", tags: ["royal"] },
          { code: "stalled_cycles", message: "no cards", cycles: 2 }
        ]
      }
    });

    assert.deepEqual(
      feedback.actions.map((action) => action.type),
      ["relax_requirements", "add_tag_producers", "add_fallback_cards", "rebalance_faction_pressure"]
    );
  });

  it("builds prompts with reviewer feedback when diagnostics are supplied", () => {
    const prompt = buildCardGenerationPrompt({
      theme: "succession crisis",
      count: 3,
      diagnostics: {
        parameters: { cycles: 2 },
        summary: { gameOverByFaction: { treasury: 2 } },
        diagnostics: { warnings: [] }
      }
    });

    assert.match(prompt, /succession crisis/);
    assert.match(prompt, /Reviewer feedback/);
    assert.match(prompt, /rebalance_faction_pressure/);
  });
});

function sampleCards() {
  return [
    {
      id: "opening",
      text: "A tax is proposed.",
      weight: 1,
      requirements: {},
      choices: [
        {
          id: "approve",
          label: "Approve",
          effects: {
            factions: { people: -10, treasury: 10 },
            tags: { taxed: true }
          }
        }
      ]
    }
  ];
}

