import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGenerationPlan,
  createCardEditor,
  createConnectorConfig,
  createI18nCatalog,
  createPlaySession,
  deriveTagCatalog,
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
  validatePlayerCards
} from "../src/index.js";

describe("ReignsAgent interface controller", () => {
  it("rejects player cards that are not pure binary left/right swipe cards", () => {
    const invalid = validatePlayerCards([
      {
        id: "lop-sided",
        choices: [{ id: "left", effects: { factions: { people: -1 } } }]
      }
    ]);

    assert.equal(invalid.valid, false);
    assert.match(invalid.errors.join("\n"), /'right' choice/);
  });

  it("edits cards in memory without touching pipeline generation logic", () => {
    const editor = createCardEditor({ cards: [sampleCard("gate")] });

    editor.addCard(sampleCard("door"));
    editor.setChoiceEffects("door", "left", { factions: { people: -3 } });
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
          { id: "left", label: "Left", effects: { factions: { people: -10 } } },
          { id: "right", label: "Right", effects: { factions: { treasury: 10 } } }
        ]
      }
    ];

    const session = createPlaySession({ cards, rng: () => 0 });
    const first = session.start();

    assert.equal(first.id, "always");
    const swipe = session.swipe("right");
    assert.equal(swipe.factions.treasury, 60);
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
          { id: "left", label: "Open", effects: { factions: { people: 2 } } },
          { id: "right", label: "Close", effects: { factions: { military: 2 } } }
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
      css: {
        variables: { "--accent": "#d0a44a" },
        text: ".card { outline: 1px solid red; }"
      },
      html: { bodyEnd: "<div>trusted host only</div>" },
      js: { module: "console.log('trusted host only')" }
    });

    assert.equal(presentation.css.variables["--accent"], "#d0a44a");
    assert.equal(presentation.css.text.includes("outline"), true);
    assert.deepEqual(presentation.active, { cssText: false, html: false, js: false });

    const trusted = normalizePresentationConfig({
      css: { variables: {}, text: ".stage { padding: 1px; }" },
      policy: { allowCssText: true, allowHtml: true, allowJs: true }
    });
    assert.deepEqual(trusted.active, { cssText: true, html: true, js: true });
  });

  it("ends the session when a faction leaves its bounds", () => {
    const cards = [
      {
        id: "doom",
        text: "Pick.",
        weight: 1,
        choices: [
          { id: "left", label: "Left", effects: { factions: { people: -100 } } },
          { id: "right", label: "Right", effects: { factions: { people: -100 } } }
        ]
      }
    ];

    const session = createPlaySession({ cards, rng: () => 0 });
    session.start();
    const swipe = session.swipe("left");

    assert.deepEqual(swipe.gameOver, { reason: "faction_bounds", faction: "people", value: 0 });
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
          { id: "left", label: "Left", effects: { factions: { people: -5 } } },
          { id: "right", label: "Right", effects: { factions: { treasury: 5 } } }
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
        gameOverByFaction: { faith: 0, people: 1, military: 0, treasury: 0 },
        factionAverages: { faith: 50, people: 45, military: 50, treasury: 55 }
      },
      coverage: {
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
    assert.deepEqual(projection.graph.unreachableCards, ["locked"]);
    assert.deepEqual(projection.warnings[0].details.cardIds, ["locked"]);
    assert.equal(projection.factions.find((entry) => entry.faction === "people").gameOverShare, 0.1);
  });

  it("summarizes reviewer feedback into correction actions for the dashboard", () => {
    const feedback = summarizeFeedback({
      module: "ReignsAgent-Reviewer",
      parameters: { cycles: 4 },
      summary: { gameOverByFaction: { people: 1 } },
      diagnostics: {
        warnings: [
          { code: "unsatisfied_required_tags", severity: "error", message: "missing", tags: ["crown"] }
        ]
      }
    });

    assert.equal(feedback.summary.actionCount, 1);
    assert.equal(feedback.actions[0].type, "add_tag_producers");
    assert.deepEqual(feedback.actions[0].target, ["crown"]);
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
    assert.deepEqual(build.player.factions, ["faith", "people", "military", "treasury"]);
    assert.equal(build.player.i18n.defaultLocale, "en");
    assert.equal(build.presentation.active.js, false);
    assert.equal(build.content.cards.length, 2);

    const serialized = serializeBuild(build);
    assert.match(serialized, /"schemaVersion": 1/);
    assert.match(serialized, /"choiceModel": "binary"/);
  });

  it("refuses to build when player cards are not binary", () => {
    const editor = createCardEditor({ cards: [sampleCard("gate")] });
    editor.addCard({ id: "broken", choices: [{ id: "left", effects: {} }] });
    assert.throws(() => prepareGameBuild({ editor }), /player cards are invalid/);
  });

  it("projects faction maps into left/right gauge data", () => {
    const gauges = projectFactionGauges({ people: 25, treasury: 80 });
    assert.equal(gauges.people.value, 25);
    assert.equal(gauges.people.right, 75);
    assert.equal(gauges.treasury.left, 80);
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
      { id: "left", label: "Left", effects: { factions: { people: -3 } } },
      { id: "right", label: "Right", effects: { factions: { treasury: 3 } } }
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
