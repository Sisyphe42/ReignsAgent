import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import {
  buildAssetGenerationRequest,
  buildCardGenerationRequest,
  buildCardGenerationPrompt,
  createContentBundle,
  createDiagnosticFeedback,
  generateAssetDrafts,
  generateCardDrafts,
  parseContentJson,
  parseCardsCsv,
  parseCardsJson,
  stringifyContentJson,
  stringifyCardsCsv,
  validateContentBundle,
  validateCardSet,
  writeCardsCsv,
  writeCardsJson
} from "../src/index.js";

const execFileAsync = promisify(execFile);

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

  it("round-trips content bundles with metadata and assets", () => {
    const bundle = createContentBundle({
      metadata: { title: "Court Test", version: "0.1.0" },
      cards: sampleCards(),
      assets: [{ id: "opening-portrait", cardId: "opening", uri: "memory://opening" }]
    });
    const parsed = parseContentJson(stringifyContentJson(bundle));

    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.metadata.title, "Court Test");
    assert.equal(parsed.assets[0].cardId, "opening");
    assert.deepEqual(validateContentBundle(parsed), { valid: true, errors: [], warnings: [] });
  });

  it("uses connector boundaries for card and asset generation", async () => {
    const connector = {
      name: "stub",
      async generateText(request) {
        assert.equal(request.purpose, "card_generation");
        assert.match(request.requestId, /^card_generation:/);
        assert.equal(request.metadata.theme, "small kingdom");
        assert.match(request.prompt, /low-level tags and variables/);
        return {
          text: `\`\`\`json\n${JSON.stringify({ cards: sampleCards() })}\n\`\`\``
        };
      },
      async generateAsset(request) {
        assert.match(request.requestId, /^card_asset_generation:/);
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

  it("builds stable generation requests without calling a connector", () => {
    const first = buildCardGenerationRequest({
      theme: "small kingdom",
      count: 2,
      constraints: { tone: "dry" }
    });
    const second = buildCardGenerationRequest({
      theme: "small kingdom",
      count: 2,
      constraints: { tone: "dry" }
    });
    const assetRequest = buildAssetGenerationRequest({ card: sampleCards()[0], style: "ink portrait" });

    assert.equal(first.requestId, second.requestId);
    assert.equal(first.schema.required[0], "cards");
    assert.equal(assetRequest.cardId, "opening");
    assert.match(assetRequest.prompt, /ink portrait/);
  });

  it("turns reviewer diagnostics into generation feedback actions", () => {
    const feedback = createDiagnosticFeedback({
      module: "ReignsAgent-Reviewer",
      parameters: { cycles: 10 },
      summary: { gameOverByFaction: { people: 6, faith: 0 } },
      diagnostics: {
        warnings: [
          { code: "never_visited_cards", message: "unreached", cardIds: ["hidden"] },
          { code: "unreachable_cards", severity: "error", message: "unreachable", cardIds: ["hidden"] },
          {
            code: "low_card_cycle_coverage",
            severity: "warning",
            message: "low coverage",
            cards: [{ cardId: "rare", rate: 0.01 }]
          },
          { code: "unsatisfied_required_tags", message: "missing tags", tags: ["royal"] },
          { code: "unsatisfied_required_variables", message: "missing variables", variables: ["edictSigned"] },
          { code: "unsatisfied_required_factions", message: "missing faction threshold", factions: ["people"] },
          { code: "stalled_cycles", message: "no cards", cycles: 2 },
          { code: "high_game_over_rate", severity: "warning", message: "too many endings" }
        ]
      }
    });

    assert.deepEqual(
      feedback.actions.map((action) => action.type),
      [
        "relax_requirements",
        "repair_reachability",
        "raise_card_exposure",
        "add_tag_producers",
        "add_variable_producers",
        "adjust_faction_requirements",
        "add_fallback_cards",
        "rebalance_faction_pressure"
      ]
    );
    assert.equal(feedback.summary.actionCount, 8);
    assert.equal(feedback.summary.errorCount, 6);
    assert.equal(feedback.summary.warningCount, 2);
  });

  it("returns aggregate validation diagnostics for malformed card data", () => {
    const validation = validateCardSet([
      {
        id: "duplicate",
        choices: [{ id: "left", effects: { factions: { faith: 1 } } }]
      },
      {
        id: "duplicate",
        weight: -1,
        requirements: { allTags: "not-array" },
        choices: [{ id: "left", effects: { factions: { unknown: 1 }, typo: true } }]
      }
    ]);

    assert.equal(validation.valid, false);
    assert.match(validation.errors.join("\n"), /Duplicate card id/);
    assert.match(validation.errors.join("\n"), /weight must be a positive finite number/);
    assert.match(validation.errors.join("\n"), /allTags must be an array/);
    assert.match(validation.errors.join("\n"), /unknown faction/);
    assert.match(validation.errors.join("\n"), /unknown key 'typo'/);
  });

  it("validates default gauge threshold requirements", () => {
    const valid = validateCardSet([
      {
        id: "grain-branch",
        requirements: {
          allTags: ["grainRelief"],
          variables: { openingPetition: "grain" },
          factions: { people: { min: 55 }, treasury: { max: 48 } }
        },
        choices: [{ id: "left", label: "Left", effects: {} }]
      }
    ]);
    const invalid = validateCardSet([
      {
        id: "bad-branch",
        requirements: { factions: { morale: { min: 5 }, people: { floor: 55 } } },
        choices: [{ id: "left", label: "Left", effects: {} }]
      }
    ]);

    assert.equal(valid.valid, true);
    assert.equal(invalid.valid, false);
    assert.match(invalid.errors.join("\n"), /unknown faction 'morale'/);
    assert.match(invalid.errors.join("\n"), /unknown key 'floor'/);
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

  it("converts card files through the local content tool", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reigns-agent-convert-"));

    try {
      const jsonPath = join(dir, "cards.json");
      const csvPath = join(dir, "cards.csv");

      await writeCardsJson(jsonPath, sampleCards());
      const { stdout } = await execFileAsync(process.execPath, ["scripts/content-tool.mjs", "convert", jsonPath, csvPath]);
      const result = JSON.parse(stdout);

      assert.equal(result.cards, 1);
      assert.match(await readFile(csvPath, "utf8"), /opening/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
