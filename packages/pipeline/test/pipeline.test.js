import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import {
  applyAiEditPatches,
  buildAssetGenerationRequest,
  buildAiContext,
  buildCardEditRequest,
  buildCardGenerationRequest,
  buildCardGenerationPrompt,
  buildMediaEditRequest,
  createContentBundle,
  createAiEditSuggestions,
  createAiEditSuggestionsFromEndpoint,
  createDiagnosticFeedback,
  executeImageOperation,
  generateAssetDrafts,
  generateCardDrafts,
  listAiEndpointModels,
  parseContentJson,
  parseCardsCsv,
  parseCardsJson,
  stringifyContentJson,
  stringifyCardsCsv,
  getImageEndpointCapabilities,
  validateAiEditEndpoint,
  validateImageEndpointConfig,
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
      summary: { gameOverByFaction: { gauge1: 6, gauge0: 0 } },
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
          { code: "unsatisfied_required_factions", message: "missing faction threshold", factions: ["gauge1"] },
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
        choices: [{ id: "left", effects: { factions: { gauge0: 1 } } }]
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

  it("normalizes legacy faction keys when parsing content", () => {
    const cards = parseCardsJson(JSON.stringify({
      cards: [{
        id: "legacy",
        text: "Legacy key import.",
        requirements: { factions: { people: { min: 55 } } },
        choices: [{ id: "left", label: "Left", effects: { factions: { faith: 1, treasury: -1 } } }]
      }]
    }));

    assert.deepEqual(cards[0].requirements.factions, { gauge1: { min: 55 } });
    assert.deepEqual(cards[0].choices[0].effects.factions, { gauge0: 1, gauge3: -1 });
  });

  it("validates default gauge threshold requirements", () => {
    const valid = validateCardSet([
      {
        id: "grain-branch",
        requirements: {
          allTags: ["grainRelief"],
          variables: { openingPetition: "grain" },
          factions: { gauge1: { min: 55 }, gauge3: { max: 48 } }
        },
        choices: [{ id: "left", label: "Left", effects: {} }]
      }
    ]);
    const invalid = validateCardSet([
      {
        id: "bad-branch",
        requirements: { factions: { morale: { min: 5 }, gauge1: { floor: 55 } } },
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
        summary: { gameOverByFaction: { gauge3: 2 } },
        diagnostics: { warnings: [] }
      }
    });

    assert.match(prompt, /succession crisis/);
    assert.match(prompt, /Reviewer feedback/);
    assert.match(prompt, /rebalance_faction_pressure/);
  });

  it("builds AI edit context and card edit requests with project guidance", () => {
    const bundle = createContentBundle({ cards: binaryCards(), metadata: { title: "Court Test" } });
    const context = buildAiContext({
      bundle,
      instruction: "Add a court debate.",
      targetCardIds: ["opening"],
      constraints: { tone: "dry" }
    });
    const request = buildCardEditRequest({
      bundle,
      instruction: "Add a court debate.",
      targetCardIds: ["opening"]
    });

    assert.equal(context.project.product, "ReignsAgent");
    assert.match(context.project.gameplayRule, /left and right/);
    assert.equal(context.selection.cards[0].id, "opening");
    assert.equal(request.purpose, "card_edit");
    assert.match(request.requestId, /^card_edit:/);
    assert.equal(request.context.instruction, "Add a court debate.");
  });

  it("creates deterministic AI card draft suggestions with binary choices", () => {
    const bundle = createContentBundle({ cards: binaryCards(), metadata: { title: "Court Test" } });
    const first = createAiEditSuggestions({
      bundle,
      mode: "generate_cards",
      config: { provider: "stub", theme: "harbor trial", cardCount: 2 },
      instruction: "Make the choices restrained."
    });
    const second = createAiEditSuggestions({
      bundle,
      mode: "generate_cards",
      config: { provider: "stub", theme: "harbor trial", cardCount: 2 },
      instruction: "Make the choices restrained."
    });

    assert.deepEqual(first.proposals, second.proposals);
    assert.equal(first.proposals.length, 2);
    assert.deepEqual(first.proposals[0].patches[0].card.choices.map((choice) => choice.id), ["left", "right"]);
    assert.equal(first.proposals[0].patches[0].card.id.startsWith("ai-harbor-trial"), true);
  });

  it("converts diagnostics into patchable AI repair suggestions", () => {
    const bundle = createContentBundle({ cards: binaryCards() });
    const plan = createAiEditSuggestions({
      bundle,
      mode: "repair_diagnostics",
      targetCardId: "opening",
      diagnostics: {
        warnings: [
          { code: "low_card_cycle_coverage", severity: "warning", message: "low", details: { cards: [{ cardId: "hidden", rate: 0.01 }] } },
          { code: "unreachable_cards", severity: "error", message: "blocked", details: { cardIds: ["hidden"] } },
          { code: "unsatisfied_required_tags", severity: "error", message: "missing", details: { tags: ["seal"] } },
          { code: "stalled_cycles", severity: "error", message: "stalled" },
          { code: "dominant_game_over_faction", severity: "warning", message: "pressure", details: { faction: "gauge1" } }
        ]
      }
    });

    assert.equal(plan.feedback.summary.actionCount, 5);
    assert.equal(plan.proposals.some((proposal) => proposal.patches.some((patch) => patch.op === "updateCard")), true);
    assert.equal(plan.proposals.some((proposal) => proposal.patches.some((patch) => patch.op === "setChoiceEffects")), true);
    assert.equal(plan.proposals.some((proposal) => proposal.patches.some((patch) => patch.op === "addCard")), true);
  });

  it("applies AI edit patches and rejects invalid operations", () => {
    const bundle = createContentBundle({ cards: binaryCards(), metadata: { title: "Before" } });
    const result = applyAiEditPatches({
      bundle,
      patches: [
        { op: "setMetadata", metadata: { title: "After" } },
        { op: "setChoiceLabel", cardId: "opening", choiceId: "left", label: "Listen" },
        { op: "upsertAsset", asset: { id: "opening-ai", cardId: "opening", uri: "pending://opening" } }
      ]
    });

    assert.equal(result.bundle.metadata.title, "After");
    assert.equal(result.bundle.cards[0].choices.find((choice) => choice.id === "left").label, "Listen");
    assert.equal(result.bundle.assets[0].id, "opening-ai");
    assert.equal(bundle.metadata.title, "Before");
    assert.throws(
      () => applyAiEditPatches({ bundle, patches: [{ op: "removeCard", cardId: "opening" }] }),
      /Unsupported AI edit patch op/
    );
  });

  it("builds media AI edit request previews without provider calls", () => {
    const bundle = createContentBundle({
      cards: binaryCards(),
      assets: [{ id: "opening-ref", cardId: "opening", uri: "memory://opening" }]
    });
    const generateRequest = buildMediaEditRequest({
      bundle,
      mode: "generate_asset",
      targetCardId: "opening",
      style: "ink wash",
      instruction: "Make it austere."
    });
    const analyzePlan = createAiEditSuggestions({
      bundle,
      mode: "analyze_asset",
      targetCardId: "opening",
      assetId: "opening-ref",
      instruction: "Check the fit."
    });
    const assetPlan = createAiEditSuggestions({
      bundle,
      mode: "generate_asset",
      targetCardId: "opening",
      config: { provider: "stub", style: "ink wash" }
    });

    assert.equal(generateRequest.purpose, "card_asset_generation");
    assert.equal(generateRequest.context.selection.cards[0].id, "opening");
    assert.equal(analyzePlan.proposals[0].patches.length, 0);
    assert.equal(assetPlan.proposals[0].patches[0].op, "upsertAsset");
  });

  it("builds AI edit proposals from a responses endpoint without echoing secrets", async () => {
    const calls = [];
    const bundle = createContentBundle({ cards: binaryCards(), metadata: { title: "Court Test" } });
    const plan = await createAiEditSuggestionsFromEndpoint({
      bundle,
      mode: "generate_cards",
      config: {
        provider: "responses",
        endpoint: "http://endpoint.test/v1",
        modelId: "draft-model",
        capabilities: ["structuredJson"],
        apiKeyRef: "browser-local",
        apiKey: "must-not-return"
      },
      credentials: { apiKey: "secret-key" },
      instruction: "Rename the first choice.",
      fetchImpl: async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            output: [{
              content: [{
                text: "```json\n{\"proposals\":[{\"id\":\"rename-left\",\"title\":\"Rename left\",\"summary\":\"Tightens the label.\",\"patches\":[{\"op\":\"setChoiceLabel\",\"cardId\":\"opening\",\"choiceId\":\"left\",\"label\":\"Listen\"}]}]}\n```"
              }]
            }]
          })
        };
      }
    });

    assert.equal(calls[0].url, "http://endpoint.test/v1/responses");
    assert.equal(calls[0].options.headers.authorization, "Bearer secret-key");
    assert.equal(calls[0].body.model, "draft-model");
    assert.equal(calls[0].body.text.format.type, "json_object");
    assert.match(calls[0].body.input, /Professional ReignsAgent editing rules/);
    assert.match(calls[0].body.input, /one tense binary decision/);
    assert.match(calls[0].body.input, /Do not introduce built-in RPG-style management/);
    assert.equal(plan.proposals[0].patches[0].label, "Listen");
    assert.equal(plan.config.apiKey, undefined);
    assert.equal(JSON.stringify(plan).includes("secret-key"), false);
    assert.equal(JSON.stringify(plan).includes("must-not-return"), false);
  });

  it("validates AI edit endpoints through the real protocol request path", async () => {
    const calls = [];
    const bundle = createContentBundle({ cards: binaryCards(), metadata: { title: "Court Test" } });
    const result = await validateAiEditEndpoint({
      bundle,
      config: {
        provider: "openai_chat",
        endpoint: "'http://endpoint.test/v1';",
        modelId: "chat-model",
        capabilities: ["structuredJson"],
        apiKeyRef: "browser-local",
        apiKey: "must-not-return"
      },
      credentials: { apiKey: "'secret-key';" },
      fetchImpl: async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({ proposals: [] })
              }
            }]
          })
        };
      }
    });

    assert.equal(calls[0].url, "http://endpoint.test/v1/chat/completions");
    assert.equal(calls[0].options.headers.authorization, "Bearer secret-key");
    assert.equal(calls[0].body.model, "chat-model");
    assert.equal(calls[0].body.response_format.type, "json_object");
    assert.match(calls[0].body.messages[1].content, /connectivity and protocol validation request/);
    assert.equal(result.ok, true);
    assert.equal(result.proposalCount, 0);
    assert.equal(result.provider.endpoint, "http://endpoint.test/v1/chat/completions");
    assert.equal(result.config.apiKey, undefined);
    assert.equal(JSON.stringify(result).includes("secret-key"), false);
    assert.equal(JSON.stringify(result).includes("must-not-return"), false);
  });

  it("lists AI endpoint models through the redacted metadata path", async () => {
    const calls = [];
    const result = await listAiEndpointModels({
      config: {
        provider: "openai_chat",
        endpoint: "http://endpoint.test/v1/chat/completions",
        routeMode: "auto",
        apiKey: "must-not-return"
      },
      credentials: { apiKey: "secret-key" },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            data: [
              { id: "chat-model", object: "model" },
              { id: "vision-model", display_name: "Vision Model" },
              { id: "chat-model" }
            ]
          })
        };
      }
    });

    assert.equal(calls[0].url, "http://endpoint.test/v1/models");
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[0].options.headers.authorization, "Bearer secret-key");
    assert.deepEqual(result.models, [
      { id: "chat-model", label: "chat-model" },
      { id: "vision-model", label: "Vision Model" }
    ]);
    assert.equal(result.provider.endpoint, "http://endpoint.test/v1/models");
    assert.equal(result.config.apiKey, undefined);
    assert.equal(JSON.stringify(result).includes("secret-key"), false);
    assert.equal(JSON.stringify(result).includes("must-not-return"), false);
  });

  it("formats messages and completions endpoint requests", async () => {
    const bundle = createContentBundle({ cards: binaryCards() });
    const calls = [];
    const makeFetch = (payload) => async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    };

    const chatPlan = await createAiEditSuggestionsFromEndpoint({
      bundle,
      config: { provider: "messages", endpoint: "http://endpoint.test/openai/chat/completions", modelId: "chat-model" },
      fetchImpl: makeFetch({
        choices: [{
          message: {
            content: JSON.stringify({
              proposals: [{ id: "chat-label", title: "Chat label", patches: [{ op: "setChoiceLabel", cardId: "opening", choiceId: "left", label: "Hear" }] }]
            })
          }
        }]
      })
    });
    const completionPlan = await createAiEditSuggestionsFromEndpoint({
      bundle,
      config: { provider: "completions", endpoint: "http://endpoint.test/v1", modelId: "completion-model" },
      fetchImpl: makeFetch({
        choices: [{
          text: JSON.stringify({
            proposals: [{ id: "completion-label", title: "Completion label", patches: [{ op: "setChoiceLabel", cardId: "opening", choiceId: "right", label: "Wait" }] }]
          })
        }]
      })
    });

    assert.equal(calls[0].url, "http://endpoint.test/openai/chat/completions");
    assert.equal(calls[0].body.messages[0].role, "system");
    assert.match(calls[0].body.messages[0].content, /specialist editor for Reigns-like card narratives/);
    assert.match(calls[0].body.messages[1].content, /Professional ReignsAgent editing rules/);
    assert.equal(calls[0].body.response_format.type, "json_object");
    assert.equal(chatPlan.proposals[0].patches[0].label, "Hear");
    assert.equal(calls[1].url, "http://endpoint.test/v1/completions");
    assert.match(calls[1].body.prompt, /Return only valid JSON/);
    assert.match(calls[1].body.prompt, /When repairing diagnostics, prioritize reachable story flow/);
    assert.equal(completionPlan.proposals[0].patches[0].label, "Wait");
  });

  it("normalizes endpoint protocol aliases and route modes", async () => {
    const bundle = createContentBundle({ cards: binaryCards() });
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                proposals: [{ id: `proposal-${calls.length}`, title: "Route", patches: [{ op: "setChoiceLabel", cardId: "opening", choiceId: "left", label: `Route ${calls.length}` }] }]
              })
            }
          }]
        })
      };
    };

    await createAiEditSuggestionsFromEndpoint({
      bundle,
      config: { provider: "openai_chat", endpoint: "http://endpoint.test/v1", modelId: "chat-model" },
      fetchImpl
    });
    await createAiEditSuggestionsFromEndpoint({
      bundle,
      config: { provider: "messages", endpoint: "http://endpoint.test/full-url", routeMode: "full_url", modelId: "chat-model" },
      fetchImpl
    });
    await createAiEditSuggestionsFromEndpoint({
      bundle,
      config: { provider: "openai_chat", endpoint: "http://endpoint.test/v1/chat/completions", routeMode: "api_root", modelId: "chat-model" },
      fetchImpl
    });

    assert.equal(calls[0].url, "http://endpoint.test/v1/chat/completions");
    assert.equal(calls[1].url, "http://endpoint.test/full-url");
    assert.equal(calls[2].url, "http://endpoint.test/v1/chat/completions/chat/completions");
  });

  it("retries OpenAI Chat once without JSON mode when the endpoint rejects response_format", async () => {
    const bundle = createContentBundle({ cards: binaryCards() });
    const calls = [];
    const plan = await createAiEditSuggestionsFromEndpoint({
      bundle,
      config: {
        provider: "openai_chat",
        endpoint: "http://endpoint.test/v1",
        modelId: "chat-model",
        capabilities: ["structuredJson"]
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        if (calls.length === 1) {
          return {
            ok: false,
            status: 400,
            text: async () => JSON.stringify({ error: { message: "response_format is not supported by this model" } })
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  proposals: [{ id: "retry-label", title: "Retry label", patches: [{ op: "setChoiceLabel", cardId: "opening", choiceId: "right", label: "Retry" }] }]
                })
              }
            }]
          })
        };
      }
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.response_format.type, "json_object");
    assert.equal(calls[1].body.response_format, undefined);
    assert.equal(plan.proposals[0].patches[0].label, "Retry");
  });

  it("rejects malformed endpoint proposals before returning a plan", async () => {
    const bundle = createContentBundle({ cards: binaryCards() });
    await assert.rejects(
      () => createAiEditSuggestionsFromEndpoint({
        bundle,
        config: { provider: "responses", endpoint: "http://endpoint.test/v1", modelId: "draft-model" },
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            proposals: [{ id: "bad-patch", title: "Bad patch", patches: [{ op: "removeCard", cardId: "opening" }] }]
          })
        })
      }),
      /Unsupported AI edit patch op/
    );
    await assert.rejects(
      () => createAiEditSuggestionsFromEndpoint({
        bundle,
        config: { provider: "responses", endpoint: "http://endpoint.test/v1", modelId: "draft-model" },
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ nope: [] }) })
      }),
      /proposals array/
    );
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

describe("image endpoint adapters", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it("publishes capability-driven config without credentials", () => {
    const validation = validateImageEndpointConfig({ config: { protocol: "openai_images", endpoint: "https://images.example/v1?token=secret", modelId: "image-model" } });
    assert.equal(validation.valid, true);
    assert.match(validation.config.endpoint, /%5Bredacted%5D/);
    assert.match(validation.routes.generate, /images\/generations/);
    assert.deepEqual(getImageEndpointCapabilities({ protocol: "gemini_interactions" }).operations, ["generate", "edit", "inpaint", "outpaint"]);
    assert.deepEqual(getImageEndpointCapabilities({ protocol: "midjourney_proxy" }).operations, ["generate", "edit"]);
    assert.match(validateImageEndpointConfig({ config: { protocol: "midjourney_proxy", endpoint: "https://mj.example", modelId: "MID_JOURNEY" } }).routes.generate, /mj\/submit\/imagine/);
    assert.throws(() => validateImageEndpointConfig({ config: { endpoint: "not-a-url", modelId: "image-model" } }), { code: "image_endpoint_url_invalid" });
  });

  it("maps OpenAI generation JSON and materializes base64 output", async () => {
    let call;
    const result = await executeImageOperation({
      config: { protocol: "openai_images", endpoint: "https://images.example/v1", modelId: "image-model" },
      credentials: { apiKey: "secret" },
      request: { operation: "generate", prompt: "A court", output: { format: "png", count: 1 } },
      fetchImpl: async (url, init) => {
        call = { url, init, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(png).toString("base64") }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    assert.equal(call.url, "https://images.example/v1/images/generations");
    assert.equal(call.init.headers.authorization, "Bearer secret");
    assert.equal(call.body.output_format, "png");
    assert.deepEqual(result.outputs[0].bytes, png);
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  });

  it("maps OpenAI edit and mask to multipart", async () => {
    let form;
    await executeImageOperation({
      config: { protocol: "openai_images", endpoint: "https://images.example/v1", modelId: "image-model" },
      request: { operation: "inpaint", prompt: "Change the banner", output: { format: "png" } },
      inputs: [
        { id: "source", bytes: png, mimeType: "image/png" },
        { id: "mask", role: "mask", bytes: png, mimeType: "image/png" }
      ],
      fetchImpl: async (url, init) => {
        assert.equal(url, "https://images.example/v1/images/edits");
        form = init.body;
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(png).toString("base64") }] }), { status: 200 });
      }
    });
    assert.equal(form.getAll("image[]").length, 1);
    assert.equal(form.get("mask").type, "image/png");
  });

  it("maps Gemini inline references and image response blocks", async () => {
    let body;
    const result = await executeImageOperation({
      config: { protocol: "gemini_interactions", endpoint: "https://gemini.example/v1beta", modelId: "gemini-image" },
      credentials: { apiKey: "google-key" },
      request: { operation: "edit", prompt: "Change the light", output: { format: "jpeg", aspectRatio: "3:4" } },
      inputs: [{ id: "source", bytes: png, mimeType: "image/png" }],
      fetchImpl: async (url, init) => {
        assert.equal(url, "https://gemini.example/v1beta/interactions");
        assert.equal(init.headers["x-goog-api-key"], "google-key");
        body = JSON.parse(init.body);
        return new Response(JSON.stringify({ output_image: { data: Buffer.from(png).toString("base64"), mime_type: "image/png" } }), { status: 200 });
      }
    });
    assert.equal(body.input[1].type, "image");
    assert.equal(body.response_format.aspect_ratio, "3:4");
    assert.equal(result.outputs[0].mimeType, "image/png");
  });

  it("maps Stability outpaint parameters and direct binary output", async () => {
    let form;
    const result = await executeImageOperation({
      config: { protocol: "stability_v2", endpoint: "https://stability.example/v2beta", modelId: "stable-image" },
      request: { operation: "outpaint", prompt: "Extend the hall", outpaint: { left: 128, right: 64 }, output: { format: "png" } },
      inputs: [{ id: "source", bytes: png, mimeType: "image/png" }],
      fetchImpl: async (url, init) => {
        assert.equal(url, "https://stability.example/v2beta/stable-image/edit/outpaint");
        form = init.body;
        return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      }
    });
    assert.equal(form.get("left"), "128");
    assert.equal(form.get("right"), "64");
    assert.deepEqual(result.outputs[0].bytes, png);
  });

  it("submits and polls Midjourney Proxy tasks with reference images", async () => {
    const calls = [];
    const result = await executeImageOperation({
      config: { protocol: "midjourney_proxy", endpoint: "https://mj.example/mj/submit/imagine", modelId: "niji" },
      credentials: { apiKey: "mj-secret" },
      request: { operation: "edit", prompt: "Restyle the court", negativePrompt: "letters", output: { format: "png", aspectRatio: "3:4" } },
      inputs: [{ id: "source", bytes: png, mimeType: "image/png" }],
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith("/mj/submit/imagine")) {
          return new Response(JSON.stringify({ code: 1, result: "task-42" }), { status: 200 });
        }
        if (url.endsWith("/mj/task/task-42/fetch")) {
          return new Response(JSON.stringify({ status: "SUCCESS", imageUrl: "https://cdn.example/result.png" }), { status: 200 });
        }
        return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      }
    });
    const submitted = JSON.parse(calls[0].init.body);
    assert.equal(calls[0].url, "https://mj.example/mj/submit/imagine");
    assert.equal(calls[0].init.headers.authorization, "Bearer mj-secret");
    assert.equal(submitted.botType, "NIJI_JOURNEY");
    assert.match(submitted.prompt, /--ar 3:4 --no letters$/);
    assert.match(submitted.base64Array[0], /^data:image\/png;base64,/);
    assert.equal(calls[1].url, "https://mj.example/mj/task/task-42/fetch");
    assert.equal(calls[2].url, "https://cdn.example/result.png");
    assert.deepEqual(result.outputs[0].bytes, png);
    assert.doesNotMatch(JSON.stringify(result), /mj-secret/);
  });

  it("rejects unsupported Midjourney mask operations before submission", async () => {
    let called = false;
    await assert.rejects(() => executeImageOperation({
      config: { protocol: "midjourney_proxy", endpoint: "https://mj.example", modelId: "MID_JOURNEY" },
      request: { operation: "inpaint", prompt: "Change the banner" },
      inputs: [{ id: "source", bytes: png, mimeType: "image/png" }],
      fetchImpl: async () => { called = true; }
    }), { code: "image_capability_unsupported" });
    assert.equal(called, false);
  });

  it("routes every Gemini operation through JSON image blocks", async () => {
    const calls = [];
    for (const operation of ["generate", "edit", "inpaint", "outpaint"]) {
      const inputs = operation === "generate" ? [] : [{ id: "source", bytes: png, mimeType: "image/png" }];
      if (operation === "inpaint") inputs.push({ id: "mask", role: "mask", bytes: png, mimeType: "image/png" });
      await executeImageOperation({
        config: { protocol: "gemini_interactions", endpoint: "https://gemini.example/v1beta", modelId: "gemini-image" },
        request: { operation, prompt: `${operation} image`, outpaint: { right: 32 } },
        inputs,
        fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ output_image: { data: Buffer.from(png).toString("base64"), mime_type: "image/png" } }), { status: 200 }); }
      });
    }
    assert.equal(calls.every((call) => call.url === "https://gemini.example/v1beta/interactions"), true);
    assert.match(calls.at(-1).body.input[0].text, /right 32px/);
  });

  it("routes every Stability operation through multipart endpoints", async () => {
    const routes = [];
    for (const operation of ["generate", "edit", "inpaint", "outpaint"]) {
      const inputs = operation === "generate" ? [] : [{ id: "source", bytes: png, mimeType: "image/png" }];
      if (operation === "inpaint") inputs.push({ id: "mask", role: "mask", bytes: png, mimeType: "image/png" });
      await executeImageOperation({
        config: { protocol: "stability_v2", endpoint: "https://stability.example/v2beta", modelId: "stable-image" },
        request: { operation, prompt: `${operation} image`, outpaint: { up: 16 } },
        inputs,
        fetchImpl: async (url, init) => { routes.push(url); assert.equal(init.body instanceof FormData, true); return new Response(png, { status: 200, headers: { "content-type": "image/png" } }); }
      });
    }
    assert.deepEqual(routes, [
      "https://stability.example/v2beta/stable-image/generate/core",
      "https://stability.example/v2beta/stable-image/edit/inpaint",
      "https://stability.example/v2beta/stable-image/edit/inpaint",
      "https://stability.example/v2beta/stable-image/edit/outpaint"
    ]);
  });

  it("rejects unsupported declared operations before fetch", async () => {
    let called = false;
    await assert.rejects(() => executeImageOperation({
      config: { protocol: "openai_images", endpoint: "https://images.example/v1", modelId: "image-model", capabilities: ["generate"] },
      request: { operation: "edit", prompt: "Edit" },
      inputs: [{ id: "source", bytes: png, mimeType: "image/png" }],
      fetchImpl: async () => { called = true; }
    }), { code: "image_capability_unsupported" });
    assert.equal(called, false);
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
            factions: { gauge1: -10, gauge3: 10 },
            tags: { taxed: true }
          }
        }
      ]
    }
  ];
}

function binaryCards() {
  return [
    {
      id: "opening",
      text: "A tax is proposed.",
      weight: 1,
      requirements: {},
      choices: [
        { id: "left", label: "Approve", effects: { factions: { gauge1: -4, gauge3: 4 } } },
        { id: "right", label: "Refuse", effects: { factions: { gauge1: 3, gauge3: -3 } } }
      ]
    },
    {
      id: "hidden",
      text: "A sealed letter waits.",
      weight: 1,
      requirements: { allTags: ["seal"] },
      choices: [
        { id: "left", label: "Open", effects: { factions: { gauge1: -2 } } },
        { id: "right", label: "Hold", effects: { factions: { gauge3: 2 } } }
      ]
    }
  ];
}
