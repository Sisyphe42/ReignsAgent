import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyAiEditPlan,
  buildAiEditPlan,
  buildAiEditPlanAsync,
  buildGenerationPlan,
  createCardEditor,
  createConnectorConfig,
  createI18nCatalog,
  createPlaySession,
  deriveStoryGroups,
  deriveTagCatalog,
  listAiEditEndpointModels,
  loadEditorFromContent,
  localizeCard,
  normalizePresentationConfig,
  prepareGameBuild,
  projectFactionGauges,
  resolveLocale,
  runDiagnostics,
  serializeBuild,
  summarizeDiagnostics,
  summarizeFeedback,
  validateAiEditEndpointConfig,
  validatePlayerCards
} from "../src/index.js";

describe("ReignsAgent interface controller", () => {
  it("rejects player cards that are not pure binary left/right swipe cards", () => {
    const invalid = validatePlayerCards([
      {
        id: "lop-sided",
        choices: [{ id: "left", effects: { factions: { gauge1: -1 } } }]
      }
    ]);

    assert.equal(invalid.valid, false);
    assert.match(invalid.errors.join("\n"), /'right' choice/);
  });

  it("edits cards in memory without touching pipeline generation logic", () => {
    const editor = createCardEditor({ cards: [sampleCard("gate")] });

    editor.addCard(sampleCard("door"));
    editor.setChoiceEffects("door", "left", { factions: { gauge1: -3 } });
    editor.updateCard("gate", { weight: 2 });
    editor.removeCard("door");

    assert.equal(editor.cardCount(), 1);
    assert.equal(editor.findCard("gate").weight, 2);
    assert.equal(editor.validate().valid, true);
  });

  it("round-trips an editor through the pipeline content bundle parser", () => {
    const editor = createCardEditor({ cards: [sampleCard("gate")], metadata: { title: "Court" } });
    const bundle = editor.toBundle();
    const reloaded = loadEditorFromContent(JSON.stringify(bundle));

    assert.equal(reloaded.metadata.title, "Court");
    assert.equal(reloaded.findCard("gate").choices[0].id, "left");
  });

  it("runs a deterministic Reigns-style swipe session with snapshot/restore", () => {
    const cards = [
      {
        id: "always",
        text: "Decide.",
        weight: 1,
        choices: [
          { id: "left", label: "Left", effects: { factions: { gauge1: -10 } } },
          { id: "right", label: "Right", effects: { factions: { gauge3: 10 } } }
        ]
      }
    ];

    const session = createPlaySession({ cards, rng: () => 0 });
    const first = session.start();

    assert.equal(first.id, "always");
    const swipe = session.swipe("right");
    assert.equal(swipe.factions.gauge3, 60);
    assert.equal(swipe.gameOver, null);

    const snapshot = session.state();
    const restored = createPlaySession({ cards, state: snapshot, rng: () => 0 });
    assert.equal(restored.turn, session.turn);
  });

  it("localizes cards and play sessions through an i18n catalog", () => {
    const i18n = createI18nCatalog({
      defaultLocale: "en",
      supportedLocales: ["en", "zh-Hans"]
    });
    const cards = [
      {
        id: "gate",
        text: "Open the gate.",
        i18n: {
          "zh-Hans": {
            text: "打开城门。",
            choices: {
              left: { label: "开放" },
              right: { label: "关闭" }
            }
          }
        },
        choices: [
          { id: "left", label: "Open", effects: { factions: { gauge1: 2 } } },
          { id: "right", label: "Close", effects: { factions: { gauge2: 2 } } }
        ]
      }
    ];

    assert.equal(resolveLocale("zh-CN", i18n), "zh-Hans");
    assert.equal(localizeCard(cards[0], { locale: "zh-Hans", i18n }).text, "打开城门。");

    const session = createPlaySession({ cards, i18n, locale: "zh-CN", rng: () => 0 });
    assert.equal(session.start().text, "打开城门。");
    assert.equal(session.currentCard.choices[0].label, "开放");
  });

  it("normalizes presentation customization behind explicit policy flags", () => {
    const presentation = normalizePresentationConfig({
      gauges: {
        gauge0: { label: "Rites", description: "Temple trust" },
        gauge3: { label: "Coin", hidden: true }
      },
      css: {
        variables: { "--accent": "#d0a44a" },
        text: ".card { outline: 1px solid red; }"
      },
      html: { bodyEnd: "<div>trusted host only</div>" },
      js: { module: "console.log('trusted host only')" }
    });

    assert.equal(presentation.css.variables["--accent"], "#d0a44a");
    assert.equal(presentation.css.text.includes("outline"), true);
    assert.deepEqual(presentation.gauges.gauge0, { label: "Rites", description: "Temple trust", visible: true });
    assert.deepEqual(presentation.gauges.gauge3, { label: "Coin", visible: false });
    assert.deepEqual(presentation.active, { cssText: false, html: false, js: false });

    const legacyPresentation = normalizePresentationConfig({
      gauges: {
        people: { label: "Crowd" }
      }
    });
    assert.deepEqual(legacyPresentation.gauges.gauge1, { label: "Crowd", visible: true });

    const trusted = normalizePresentationConfig({
      css: { variables: {}, text: ".stage { padding: 1px; }" },
      policy: { allowCssText: true, allowHtml: true, allowJs: true }
    });
    assert.deepEqual(trusted.active, { cssText: true, html: true, js: true });
    assert.throws(
      () => normalizePresentationConfig({ gauges: { mana: { label: "Mana" } } }),
      /must be one of/
    );
  });

  it("ends the session when a faction leaves its bounds", () => {
    const cards = [
      {
        id: "doom",
        text: "Pick.",
        weight: 1,
        choices: [
          { id: "left", label: "Left", effects: { factions: { gauge1: -100 } } },
          { id: "right", label: "Right", effects: { factions: { gauge1: -100 } } }
        ]
      }
    ];

    const session = createPlaySession({ cards, rng: () => 0 });
    session.start();
    const swipe = session.swipe("left");

    assert.deepEqual(swipe.gameOver, { reason: "faction_bounds", faction: "gauge1", value: 0 });
  });

  it("rejects unknown swipe directions", () => {
    const session = createPlaySession({ cards: [sampleCard("gate")], rng: () => 0 });
    session.start();
    assert.throws(() => session.swipe("up"), /'left' or 'right'/);
  });

  it("projects reviewer diagnostics into a render-ready dashboard shape", () => {
    const cards = [
      {
        id: "open",
        text: "Open.",
        weight: 1,
        choices: [
          { id: "left", label: "Left", effects: { factions: { gauge1: -5 } } },
          { id: "right", label: "Right", effects: { factions: { gauge3: 5 } } }
        ]
      },
      {
        id: "locked",
        text: "Locked.",
        weight: 1,
        requirements: { allTags: ["crown"] },
        choices: [
          { id: "left", label: "Left", effects: {} },
          { id: "right", label: "Right", effects: {} }
        ]
      }
    ];

    const projection = summarizeDiagnostics({
      module: "ReignsAgent-Reviewer",
      parameters: { cycles: 10 },
      summary: {
        averageTurns: 4,
        gameOverRate: 0.1,
        stalledRate: 0,
        gameOverByFaction: { gauge0: 0, gauge1: 1, gauge2: 0, gauge3: 0 },
        factionAverages: { gauge0: 50, gauge1: 45, gauge2: 50, gauge3: 55 }
      },
      coverage: {
        cardVisitRates: { open: 1, locked: 0 },
        cardCycleRates: { open: 1, locked: 0 },
        choiceCycleRates: { left: 0.4, right: 0.6 },
        unvisitedCards: ["locked"],
        lowCycleCards: []
      },
      graph: {
        reachableCards: ["open"],
        unreachableCards: ["locked"],
        unsatisfiedRequiredTags: ["crown"],
        unsatisfiedRequiredVariables: []
      },
      diagnostics: {
        warnings: [
          { code: "unreachable_cards", severity: "error", message: "no path", cardIds: ["locked"] }
        ],
        warningCounts: { error: 1, warning: 0, info: 0 }
      }
    });

    assert.equal(projection.healthScore < 100, true);
    assert.match(projection.headline, /blocking issue/);
    assert.deepEqual(projection.coverage.cardVisitRates, { open: 1, locked: 0 });
    assert.deepEqual(projection.coverage.cardCycleRates, { open: 1, locked: 0 });
    assert.deepEqual(projection.coverage.choiceCycleRates, { left: 0.4, right: 0.6 });
    assert.deepEqual(projection.graph.unreachableCards, ["locked"]);
    assert.deepEqual(projection.warnings[0].details.cardIds, ["locked"]);
    assert.equal(projection.factions.find((entry) => entry.faction === "gauge1").gameOverShare, 0.1);
  });

  it("projects story group coverage into narrative diagnostics", () => {
    const cards = [
      {
        id: "gate",
        text: "Gate.",
        choices: [{ id: "left", label: "Left", effects: { tags: { grainRelief: true } } }]
      },
      {
        id: "granary",
        text: "Granary.",
        requirements: { allTags: ["grainRelief"] },
        choices: [{ id: "left", label: "Left", effects: {} }]
      },
      {
        id: "ending",
        text: "Ending.",
        requirements: { allTags: ["neverProduced"] },
        choices: [{ id: "left", label: "Left", effects: {} }]
      }
    ];

    const projection = summarizeDiagnostics({
      module: "ReignsAgent-Reviewer",
      parameters: { cycles: 20 },
      summary: {
        averageTurns: 5,
        gameOverRate: 0,
        stalledRate: 0,
        gameOverByFaction: {},
        factionAverages: {}
      },
      coverage: {
        cardVisitRates: { gate: 1, granary: 0.9, ending: 0 },
        cardCycleRates: { gate: 1, granary: 0.6, ending: 0 },
        choiceCycleRates: {},
        unvisitedCards: ["ending"],
        lowCycleCards: [{ cardId: "granary", rate: 0.04 }]
      },
      graph: {
        reachableCards: ["gate", "granary"],
        unreachableCards: ["ending"],
        unsatisfiedRequiredTags: ["neverProduced"],
        unsatisfiedRequiredVariables: []
      },
      diagnostics: {
        warnings: [],
        warningCounts: { error: 0, warning: 0, info: 0 }
      }
    }, {
      cards,
      metadata: {
        story: {
          groups: [
            { id: "grain", label: "Grain Thread", type: "theme", tags: ["grainRelief"] },
            { id: "ending", label: "Gate Ending", type: "ending", cardIds: ["ending"] },
            { id: "empty", label: "Empty Arc", type: "arc", tags: ["ghost"] }
          ]
        }
      }
    });

    const byId = new Map(projection.narrative.storyGroups.map((group) => [group.id, group]));
    assert.equal(projection.narrative.summary.groupCount, 3);
    assert.equal(projection.narrative.summary.issueCount, 3);
    assert.equal(byId.get("grain").status, "partial");
    assert.deepEqual(byId.get("grain").lowCycleCards, [{ cardId: "granary", rate: 0.04 }]);
    assert.equal(byId.get("ending").status, "unreachable");
    assert.deepEqual(byId.get("ending").unvisitedCardIds, ["ending"]);
    assert.equal(byId.get("empty").status, "empty");
    assert.deepEqual(
      projection.narrative.issues.map((issue) => issue.code),
      ["partial_story_group_coverage", "unreachable_story_group", "empty_story_group"]
    );
  });

  it("summarizes reviewer feedback into correction actions for the dashboard", () => {
    const feedback = summarizeFeedback({
      module: "ReignsAgent-Reviewer",
      parameters: { cycles: 4 },
      summary: { gameOverByFaction: { gauge1: 1 } },
      diagnostics: {
        warnings: [
          { code: "unsatisfied_required_tags", severity: "error", message: "missing", tags: ["crown"] },
          { code: "unsatisfied_required_factions", severity: "error", message: "missing threshold", factions: ["gauge1"] }
        ]
      }
    });

    assert.equal(feedback.summary.actionCount, 2);
    assert.equal(feedback.actions[0].type, "add_tag_producers");
    assert.deepEqual(feedback.actions[0].target, ["crown"]);
    assert.equal(feedback.actions[1].type, "adjust_faction_requirements");
    assert.deepEqual(feedback.actions[1].target, ["gauge1"]);
  });

  it("builds a connector config and generation plan without storing secrets", () => {
    const config = createConnectorConfig({
      provider: "stub",
      theme: "small kingdom",
      cardCount: 4,
      apiKeyRef: "vault://reigns/stub"
    });

    assert.equal(config.apiKeyRef, "vault://reigns/stub");
    const plan = buildGenerationPlan({ config });
    assert.equal(plan.request.metadata.theme, "small kingdom");
    assert.equal(plan.config.apiKeyRef, "vault://reigns/stub");
  });

  it("preserves AI endpoint preset compatibility metadata in connector configs", () => {
    const config = createConnectorConfig({
      provider: "openai_chat",
      endpoint: "https://api.openai.com/v1",
      modelId: "gpt-4.1-mini",
      endpointPresetId: "openai",
      endpointIconKey: "openai",
      modelPresetId: "gpt-4.1-mini",
      compatibilityFamily: "openai",
      routeMode: "auto",
      jsonMode: "auto",
      capabilities: ["structuredJson"]
    });

    assert.equal(config.endpointPresetId, "openai");
    assert.equal(config.endpointIconKey, "openai");
    assert.equal(config.modelPresetId, "gpt-4.1-mini");
    assert.equal(config.compatibilityFamily, "openai");
    assert.equal(config.routeMode, "auto");
    assert.equal(config.jsonMode, "auto");
    assert.deepEqual(config.capabilities, ["structuredJson"]);
  });

  it("builds AI edit plans through the interface boundary", () => {
    const editor = createCardEditor({ cards: [sampleCard("gate")], metadata: { title: "Court" } });
    const plan = buildAiEditPlan({
      editor,
      mode: "generate_cards",
      config: { provider: "stub", theme: "court audit", cardCount: 1 },
      instruction: "Add a restrained hearing."
    });

    assert.equal(plan.schemaVersion, 1);
    assert.equal(plan.mode, "generate_cards");
    assert.match(plan.baseFingerprint, /^bundle:/);
    assert.equal(plan.proposals.length, 1);
    assert.equal(plan.request.context.bundle.metadata.title, "Court");
  });

  it("builds provider-backed AI edit plans through the async interface boundary", async () => {
    const editor = createCardEditor({ cards: [sampleCard("gate")], metadata: { title: "Court" } });
    const calls = [];
    const plan = await buildAiEditPlanAsync({
      editor,
      mode: "generate_cards",
      config: {
        provider: "messages",
        endpoint: "http://endpoint.test/v1",
        modelId: "chat-model",
        apiKeyRef: "browser-local",
        apiKey: "must-not-return"
      },
      credentials: { apiKey: "secret-key" },
      instruction: "Rename the gate choice.",
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  proposals: [{
                    id: "rename-gate",
                    title: "Rename gate",
                    summary: "Adjusts the left label.",
                    patches: [{ op: "setChoiceLabel", cardId: "gate", choiceId: "left", label: "Hear" }]
                  }]
                })
              }
            }]
          })
        };
      }
    });

    assert.equal(calls[0].url, "http://endpoint.test/v1/chat/completions");
    assert.equal(calls[0].options.headers.authorization, "Bearer secret-key");
    assert.equal(plan.mode, "generate_cards");
    assert.equal(plan.provider.protocol, "openai_chat");
    assert.equal(plan.config.apiKey, undefined);
    assert.equal(JSON.stringify(plan).includes("secret-key"), false);
    assert.equal(JSON.stringify(plan).includes("must-not-return"), false);
    assert.equal(plan.proposals[0].patches[0].label, "Hear");
    assert.equal(editor.findCard("gate").choices[0].label, "Left");
  });

  it("validates provider endpoints through the async interface boundary without mutating the editor", async () => {
    const editor = createCardEditor({ cards: [sampleCard("gate")], metadata: { title: "Court" } });
    const calls = [];
    const result = await validateAiEditEndpointConfig({
      editor,
      config: {
        provider: "openai_chat",
        endpoint: "http://endpoint.test/v1",
        modelId: "chat-model",
        apiKeyRef: "browser-local",
        apiKey: "must-not-return"
      },
      credentials: { apiKey: "secret-key" },
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
    assert.equal(result.ok, true);
    assert.equal(result.proposalCount, 0);
    assert.equal(result.config.apiKey, undefined);
    assert.equal(JSON.stringify(result).includes("secret-key"), false);
    assert.equal(JSON.stringify(result).includes("must-not-return"), false);
    assert.equal(editor.findCard("gate").choices[0].label, "Left");
  });

  it("lists provider models through the async interface boundary without echoing secrets", async () => {
    const calls = [];
    const result = await listAiEditEndpointModels({
      config: {
        provider: "openai_chat",
        endpoint: "http://endpoint.test/v1",
        apiKeyRef: "browser-local",
        apiKey: "must-not-return"
      },
      credentials: { apiKey: "secret-key" },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [{ id: "alpha-model" }, { id: "beta-model" }] })
        };
      }
    });

    assert.equal(calls[0].url, "http://endpoint.test/v1/models");
    assert.equal(calls[0].options.headers.authorization, "Bearer secret-key");
    assert.deepEqual(result.models.map((model) => model.id), ["alpha-model", "beta-model"]);
    assert.equal(result.config.apiKey, undefined);
    assert.equal(JSON.stringify(result).includes("secret-key"), false);
    assert.equal(JSON.stringify(result).includes("must-not-return"), false);
  });

  it("builds provider-backed AI edit plans with the canonical OpenAI Chat protocol", async () => {
    const editor = createCardEditor({ cards: [sampleCard("gate")], metadata: { title: "Court" } });
    const calls = [];
    const plan = await buildAiEditPlanAsync({
      editor,
      mode: "generate_cards",
      config: {
        provider: "openai_chat",
        endpoint: "http://endpoint.test/v1",
        modelId: "chat-model",
        capabilities: ["structuredJson"]
      },
      instruction: "Rename the gate choice.",
      fetchImpl: async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  proposals: [{
                    id: "rename-gate",
                    title: "Rename gate",
                    patches: [{ op: "setChoiceLabel", cardId: "gate", choiceId: "right", label: "Stay" }]
                  }]
                })
              }
            }]
          })
        };
      }
    });

    assert.equal(calls[0].url, "http://endpoint.test/v1/chat/completions");
    assert.equal(calls[0].body.response_format.type, "json_object");
    assert.equal(plan.provider.protocol, "openai_chat");
    assert.equal(plan.proposals[0].patches[0].label, "Stay");
  });

  it("keeps async AI edit planning on local stub when no endpoint is configured", async () => {
    const editor = createCardEditor({ cards: [sampleCard("gate")] });
    let called = false;
    const plan = await buildAiEditPlanAsync({
      editor,
      mode: "generate_cards",
      config: { provider: "stub", theme: "court audit", cardCount: 1 },
      fetchImpl: async () => {
        called = true;
        throw new Error("should not call endpoint");
      }
    });

    assert.equal(called, false);
    assert.equal(plan.proposals.length, 1);
    assert.equal(plan.proposals[0].patches[0].op, "addCard");
  });

  it("applies selected AI edit proposals atomically", () => {
    const editor = createCardEditor({ cards: [sampleCard("gate")] });
    const plan = buildAiEditPlan({
      editor,
      mode: "generate_cards",
      config: { provider: "stub", theme: "court audit", cardCount: 2 }
    });
    const result = applyAiEditPlan({ editor, plan, proposalIds: [plan.proposals[0].id] });

    assert.equal(result.applied, true);
    assert.equal(result.patchCount, 1);
    assert.equal(result.bundle.cards.length, 2);
    assert.equal(editor.cardCount(), 1);
    assert.equal(result.validation.valid, true);
    assert.equal(result.playerValidation.valid, true);
  });

  it("rejects stale AI edit plans without mutating the editor", () => {
    const editor = createCardEditor({ cards: [sampleCard("gate")] });
    const plan = buildAiEditPlan({
      editor,
      mode: "generate_cards",
      config: { provider: "stub", theme: "court audit", cardCount: 1 }
    });
    editor.addCard(sampleCard("arch"));

    assert.throws(
      () => applyAiEditPlan({ editor, plan, proposalIds: [plan.proposals[0].id] }),
      /stale/
    );
    assert.equal(editor.cardCount(), 2);
  });

  it("rejects invalid AI edit patches before returning a replacement editor", () => {
    const editor = createCardEditor({ cards: [sampleCard("gate")] });
    const plan = buildAiEditPlan({
      editor,
      mode: "generate_cards",
      config: { provider: "stub", theme: "court audit", cardCount: 1 }
    });
    plan.proposals[0].patches = [{ op: "updateCard", cardId: "missing", changes: { weight: 2 } }];

    assert.throws(
      () => applyAiEditPlan({ editor, plan, proposalIds: [plan.proposals[0].id] }),
      /was not found/
    );
    assert.equal(editor.cardCount(), 1);
  });

  it("rejects connector configs with invalid card counts", () => {
    assert.throws(
      () => createConnectorConfig({ provider: "stub", cardCount: 0 }),
      /cardCount must be a positive integer/
    );
  });

  it("prepares a deployable build manifest and serializes it stably", () => {
    const editor = createCardEditor({
      cards: [sampleCard("gate"), sampleCard("arch")],
      metadata: { title: "Twin Gates", version: "1.2.0" }
    });

    const build = prepareGameBuild({ editor, buildId: "twin-1" });
    assert.equal(build.buildId, "twin-1");
    assert.equal(build.player.choiceModel, "binary");
    assert.deepEqual(build.player.factions, ["gauge0", "gauge1", "gauge2", "gauge3"]);
    assert.equal(build.player.i18n.defaultLocale, "en");
    assert.equal(build.presentation.active.js, false);
    assert.equal(build.content.cards.length, 2);

    const serialized = serializeBuild(build);
    assert.match(serialized, /"schemaVersion": 1/);
    assert.match(serialized, /"choiceModel": "binary"/);
  });

  it("derives deterministic build ids from normalized project content", () => {
    const editor = createCardEditor({
      cards: [sampleCard("gate"), sampleCard("arch")],
      metadata: { title: "Twin Gates", version: "1.2.0" }
    });
    const first = prepareGameBuild({ editor });
    const second = prepareGameBuild({ editor });
    assert.equal(first.buildId, second.buildId);
    editor.setMetadata({ title: "Changed Gates" });
    assert.notEqual(prepareGameBuild({ editor }).buildId, first.buildId);
  });

  it("refuses to build when player cards are not binary", () => {
    const editor = createCardEditor({ cards: [sampleCard("gate")] });
    editor.addCard({ id: "broken", choices: [{ id: "left", effects: {} }] });
    assert.throws(() => prepareGameBuild({ editor }), /player cards are invalid/);
  });

  it("projects faction maps into left/right gauge data", () => {
    const gauges = projectFactionGauges(
      { gauge1: 25, gauge3: 80 },
      {
        gauges: {
          gauge1: { label: "Crowd", description: "Public pressure" },
          gauge0: { hidden: true }
        }
      }
    );
    assert.equal(gauges.gauge0, undefined);
    assert.equal(gauges.gauge1.value, 25);
    assert.equal(gauges.gauge1.label, "Crowd");
    assert.equal(gauges.gauge1.description, "Public pressure");
    assert.equal(gauges.gauge1.right, 75);
    assert.equal(gauges.gauge3.left, 80);
  });

  it("runs diagnostics end-to-end through the reviewer", () => {
    const projection = runDiagnostics({
      cards: [sampleCard("gate"), sampleCard("arch")],
      cycles: 8,
      maxTurns: 4,
      seed: 2
    });

    assert.equal(projection.module, "ReignsAgent-Reviewer");
    assert.equal(projection.sampleSize, 8);
    assert.equal(Number.isInteger(projection.healthScore), true);
  });
});

function sampleCard(id) {
  return {
    id,
    text: `Card ${id}.`,
    weight: 1,
    choices: [
      { id: "left", label: "Left", effects: { factions: { gauge1: -3 } } },
      { id: "right", label: "Right", effects: { factions: { gauge3: 3 } } }
    ]
  };
}

describe("deriveTagCatalog", () => {
  it("collects produced and required tags with the right attribution", () => {
    const cards = [
      {
        id: "gate",
        choices: [
          { id: "left", effects: { tags: { grainRelief: true } } },
          { id: "right", effects: { tags: { borderAlert: true } } }
        ]
      },
      {
        id: "granary",
        requirements: { allTags: ["grainRelief"] },
        choices: [{ id: "left", effects: { tags: { granaryOpen: true } } }]
      },
      {
        id: "harbor",
        requirements: { anyTags: ["granaryOpen", "borderAlert"] },
        choices: [{ id: "left", effects: {} }]
      }
    ];

    const catalog = deriveTagCatalog({ cards });

    const byKey = new Map(catalog.tags.map((entry) => [entry.key, entry]));
    assert.equal(catalog.tags.length, 3);
    assert.deepEqual(byKey.get("grainRelief").producedBy, [{ cardId: "gate", choiceId: "left" }]);
    assert.deepEqual(byKey.get("grainRelief").requiredBy, [{ cardId: "granary", mode: "all" }]);
    assert.deepEqual(byKey.get("granaryOpen").producedBy, [{ cardId: "granary", choiceId: "left" }]);
    const harborReq = byKey.get("borderAlert").requiredBy;
    assert.equal(harborReq.length, 1);
    assert.equal(harborReq[0].mode, "any");
  });

  it("does not count a tag as produced when its effect sets it falsy", () => {
    const cards = [
      {
        id: "dismiss",
        choices: [{ id: "left", effects: { tags: { courtAlert: false } } }]
      }
    ];
    const catalog = deriveTagCatalog({ cards });
    assert.equal(catalog.tags.length, 0);
  });

  it("applies human labels from metadata.tagLabels and falls back to null", () => {
    const cards = [
      {
        id: "gate",
        choices: [{ id: "left", effects: { tags: { grainRelief: true } } }]
      }
    ];
    const labeled = deriveTagCatalog({ cards, metadata: { tagLabels: { grainRelief: "粮仓已开" } } });
    assert.equal(labeled.tags[0].label, "粮仓已开");

    const unlabeled = deriveTagCatalog({ cards, metadata: {} });
    assert.equal(unlabeled.tags[0].label, null);
  });
});

describe("deriveStoryGroups", () => {
  it("projects metadata story groups without changing runtime scheduling", () => {
    const cards = [
      {
        id: "gate",
        choices: [{ id: "left", effects: { tags: { chapterOpen: true } } }]
      },
      {
        id: "followup",
        requirements: { allTags: ["chapterOpen"] },
        choices: [{ id: "left", effects: {} }]
      },
      {
        id: "ending",
        choices: [{ id: "left", effects: {} }]
      }
    ];

    const projection = deriveStoryGroups({
      cards,
      metadata: {
        story: {
          groups: [
            { id: "opening", label: "Opening", type: "chapter", tags: ["chapterOpen"] },
            { id: "finale", label: "Finale", type: "ending", cardIds: ["ending"] }
          ]
        }
      }
    });

    assert.equal(projection.schemaVersion, 1);
    assert.deepEqual(projection.groups.map((group) => group.id), ["opening", "finale"]);
    assert.deepEqual(projection.groups[0].cardIds, ["gate", "followup"]);
    assert.deepEqual(projection.groups[1].cardIds, ["ending"]);
    assert.equal(projection.groups[0].type, "chapter");
    assert.deepEqual(cards[0].choices[0].effects.tags, { chapterOpen: true });
  });

  it("keeps empty groups visible for authoring review", () => {
    const projection = deriveStoryGroups({
      cards: [{ id: "gate", choices: [{ id: "left", effects: {} }] }],
      metadata: { story: { groups: [{ id: "missing", label: "Missing Arc", tags: ["missingTag"] }] } }
    });

    assert.equal(projection.groups[0].cardCount, 0);
    assert.deepEqual(projection.groups[0].cardIds, []);
  });
});
