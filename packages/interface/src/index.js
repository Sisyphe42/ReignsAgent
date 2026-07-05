import { FACTIONS, createRuntime, normalizeCards, normalizeFactionKey, restoreState, serializeState } from "../../core/src/index.js";
import {
  applyAiEditPatches,
  createAiEditSuggestions,
  createAiEditSuggestionsFromEndpoint,
  buildCardGenerationRequest,
  createContentBundle,
  createDiagnosticFeedback,
  parseContentJson,
  stringifyContentJson,
  validateCardSet,
  validateContentBundle
} from "../../pipeline/src/index.js";
import { analyzeCardGraph, runMonteCarloReview } from "../../reviewer/src/index.js";

const PLAYER_SCHEMA_VERSION = 1;
const BUILD_SCHEMA_VERSION = 1;
const I18N_SCHEMA_VERSION = 1;
const PRESENTATION_SCHEMA_VERSION = 1;
const DEFAULT_LOCALE = "en";
const PLAYER_CHOICE_IDS = new Set(["left", "right"]);

/**
 * Module D: creator orchestration.
 *
 * This module only wires core/pipeline/reviewer together. It never re-implements
 * game rules, AI generation, or Monte Carlo simulation, and it never performs IO.
 * Pass it dependency handles (file readers, fetch) at call time.
 */

export class InterfaceError extends Error {
  constructor(message, code = "interface_error") {
    super(message);
    this.name = "InterfaceError";
    this.code = code;
  }
}

export function FACTION_KEYS() {
  return [...FACTIONS];
}

/**
 * validatePlayerCards enforces the player-facing Reigns contract: every card must
 * carry a binary left/right choice pair so the visible game is pure swipe interaction.
 * The system never predefines upper-level RPG systems; this only enforces the shape.
 */
export function validatePlayerCards(cards) {
  const errors = [];

  if (!Array.isArray(cards)) {
    return { valid: false, errors: ["Player cards must be an array"] };
  }

  const cardValidation = validateCardSet(cards);
  errors.push(...cardValidation.errors);

  const seenCardIds = new Set();

  for (const [cardIndex, card] of cards.entries()) {
    if (!card || typeof card !== "object" || !card.id) {
      continue;
    }

    if (seenCardIds.has(card.id)) {
      continue;
    }
    seenCardIds.add(card.id);

    if (!Array.isArray(card.choices)) {
      continue;
    }

    const left = card.choices.find((choice) => choice?.id === "left");
    const right = card.choices.find((choice) => choice?.id === "right");

    if (!left) {
      errors.push(`Card '${card.id}' (index ${cardIndex}) requires a 'left' choice`);
    }

    if (!right) {
      errors.push(`Card '${card.id}' (index ${cardIndex}) requires a 'right' choice`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * createI18nCatalog normalizes locale metadata for interface and player use.
 * Card text remains plain data; localization is resolved at the interface edge.
 */
export function createI18nCatalog(input = {}) {
  const source = input?.i18n ?? input ?? {};
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new InterfaceError("i18n catalog must be an object");
  }

  const defaultLocale = isNonEmptyString(source.defaultLocale) ? source.defaultLocale : DEFAULT_LOCALE;
  const requestedLocales = Array.isArray(source.supportedLocales)
    ? source.supportedLocales
    : Array.isArray(source.locales)
      ? source.locales
      : [];
  const supportedLocales = [...new Set([defaultLocale, ...requestedLocales])];

  for (const locale of supportedLocales) {
    if (!isNonEmptyString(locale)) {
      throw new InterfaceError("i18n supportedLocales must contain only non-empty strings");
    }
  }

  return {
    schemaVersion: I18N_SCHEMA_VERSION,
    defaultLocale,
    supportedLocales,
    messages: cloneJsonSafe(source.messages ?? {}, "i18n messages")
  };
}

export function resolveLocale(requestedLocale, catalogOrMetadata = {}) {
  const source = catalogOrMetadata?.i18n ?? catalogOrMetadata ?? {};
  const defaultLocale = isNonEmptyString(source.defaultLocale) ? source.defaultLocale : DEFAULT_LOCALE;
  const supportedLocales = Array.isArray(source.supportedLocales) ? source.supportedLocales : [];

  if (!isNonEmptyString(requestedLocale)) {
    return defaultLocale;
  }

  if (supportedLocales.length === 0 || supportedLocales.includes(requestedLocale)) {
    return requestedLocale;
  }

  const language = requestedLocale.split("-")[0];
  const regionalMatch = supportedLocales.find((locale) => locale.split("-")[0] === language);
  return regionalMatch ?? defaultLocale;
}

export function localizeCards(cards, options = {}) {
  return cloneCards(cards).map((card) => localizeCard(card, options));
}

export function localizeCard(card, options = {}) {
  assertPlainRecord(card, "Card");
  const i18n = options.i18n ?? options.metadata?.i18n ?? {};
  const locale = resolveLocale(options.locale, i18n);
  const defaultLocale = resolveLocale(null, i18n);
  const localizedCard = pickLocaleEntry(card.i18n, locale, defaultLocale);
  const localizedChoices = card.choices?.map((choice) => {
    const cardChoice = localizedCard?.choices?.[choice.id] ?? {};
    const choiceEntry = pickLocaleEntry(choice.i18n, locale, defaultLocale);
    return {
      ...choice,
      label: choiceEntry?.label ?? cardChoice.label ?? choice.label
    };
  });

  return cloneJsonSafe(
    {
      ...card,
      locale,
      text: localizedCard?.text ?? card.text,
      choices: localizedChoices ?? card.choices
    },
    `Localized card '${card.id ?? "unknown"}'`
  );
}

/**
 * normalizePresentationConfig keeps customization explicit and policy-gated.
 * CSS variables are safe to apply. Raw CSS, HTML, and JS are preserved for
 * trusted downstream hosts but are disabled by default in built-in players.
 */
export function normalizePresentationConfig(config = {}) {
  const source = config?.presentation ?? config ?? {};
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new InterfaceError("Presentation config must be an object");
  }

  const css = source.css ?? {};
  assertPlainRecord(css, "Presentation css");

  const policy = normalizePresentationPolicy(source.policy ?? {});
  const cssText = css.text ?? source.cssText ?? "";
  if (typeof cssText !== "string") {
    throw new InterfaceError("Presentation css.text must be a string");
  }

  return {
    schemaVersion: PRESENTATION_SCHEMA_VERSION,
    css: {
      variables: normalizeCssVariables(css.variables ?? source.cssVariables ?? {}),
      text: cssText
    },
    gauges: normalizeGaugePresentation(source.gauges ?? {}),
    html: normalizeStringSlots(source.html ?? {}),
    js: normalizeStringSlots(source.js ?? {}),
    policy,
    active: {
      cssText: policy.allowCssText,
      html: policy.allowHtml,
      js: policy.allowJs
    }
  };
}

/**
 * createCardEditor keeps an editable working copy of a card set in memory.
 * It does not validate AI output; it defers to the pipeline contract helpers.
 */
export function createCardEditor(options = {}) {
  const cards = cloneCards(options.cards ?? []);
  const metadata = cloneJsonSafe(options.metadata ?? {}, "Editor metadata");
  const assets = cloneJsonSafe(options.assets ?? [], "Editor assets");

  const editor = {
    get cards() {
      return cloneCards(cards);
    },

    get metadata() {
      return cloneJsonSafe(metadata, "Editor metadata");
    },

    get assets() {
      return cloneJsonSafe(assets, "Editor assets");
    },

    cardCount() {
      return cards.length;
    },

    findCard(cardId) {
      const card = cards.find((candidate) => candidate.id === cardId);
      return card ? cloneJsonSafe(card, `Card '${cardId}'`) : null;
    },

    addCard(card) {
      assertPlainRecord(card, "Card");
      if (!isNonEmptyString(card.id)) {
        throw new InterfaceError("addCard requires a card with a non-empty id");
      }
      if (cards.some((candidate) => candidate.id === card.id)) {
        throw new InterfaceError(`Card '${card.id}' already exists`);
      }
      cards.push(cloneJsonSafe(card, `Card '${card.id}'`));
      return editor.findCard(card.id);
    },

    updateCard(cardId, changes) {
      assertPlainRecord(changes, "Card changes");
      const index = cards.findIndex((candidate) => candidate.id === cardId);
      if (index === -1) {
        throw new InterfaceError(`Card '${cardId}' was not found`);
      }
      const merged = { ...cards[index], ...changes };
      if (changes.id !== undefined) {
        if (!isNonEmptyString(changes.id)) {
          throw new InterfaceError("Card id must be a non-empty string");
        }
        if (changes.id !== cardId && cards.some((candidate) => candidate.id === changes.id)) {
          throw new InterfaceError(`Card '${changes.id}' already exists`);
        }
      }
      cards[index] = cloneJsonSafe(merged, `Card '${merged.id}'`);
      return editor.findCard(merged.id);
    },

    removeCard(cardId) {
      const index = cards.findIndex((candidate) => candidate.id === cardId);
      if (index === -1) {
        return false;
      }
      cards.splice(index, 1);
      return true;
    },

    setChoiceLabel(cardId, choiceId, label) {
      const card = requireCard(cards, cardId);
      const choice = requireChoice(card, choiceId);
      choice.label = label;
      return cloneJsonSafe(card, `Card '${cardId}'`);
    },

    setChoiceEffects(cardId, choiceId, effects) {
      assertPlainRecord(effects, "Choice effects");
      const cardIndex = cards.findIndex((candidate) => candidate.id === cardId);
      const card = requireCard(cards, cardId);
      const choice = requireChoice(card, choiceId);
      choice.effects = cloneJsonSafe(effects, `Card '${cardId}' choice '${choiceId}' effects`);
      const normalizedCard = cloneCards([card])[0];
      cards[cardIndex] = normalizedCard;
      return cloneJsonSafe(normalizedCard, `Card '${cardId}'`);
    },

    setMetadata(nextMetadata) {
      assertPlainRecord(nextMetadata, "Metadata");
      for (const [key, value] of Object.entries(nextMetadata)) {
        metadata[key] = cloneJsonSafe(value, `Metadata '${key}'`);
      }
      return cloneJsonSafe(metadata, "Editor metadata");
    },

    validate() {
      return validateCardSet(cards);
    },

    validateForPlayer() {
      return validatePlayerCards(cards);
    },

    toCards() {
      return cloneCards(cards);
    },

    toBundle() {
      return createContentBundle({ cards: cloneCards(cards), metadata: cloneJsonSafe(metadata, "Editor metadata"), assets: cloneJsonSafe(assets, "Editor assets") });
    }
  };

  return editor;
}

/**
 * loadEditorFromContent accepts parsed/serialized content and hands it to the
 * pipeline content bundle parser so the interface never duplicates parsing rules.
 */
export function loadEditorFromContent(source) {
  const bundle = typeof source === "string" ? parseContentJson(source) : createContentBundle(source);
  return createCardEditor({ cards: bundle.cards, metadata: bundle.metadata, assets: bundle.assets });
}

/**
 * createPlaySession is the Reigns-style swipe loop driven by the headless core.
 * It is the single source of truth for the player-facing experience: draw a card,
 * swipe left/right, observe factions and game-over, and snapshot/restore.
 */
export function createPlaySession(options = {}) {
  const cards = cloneCards(options.cards ?? []);
  const i18n = createI18nCatalog(options.i18n ?? options.metadata?.i18n ?? {});
  let locale = resolveLocale(options.locale, i18n);
  const playerValidation = validatePlayerCards(cards);
  if (!playerValidation.valid) {
    throw new InterfaceError(`Player cards are invalid:\n- ${playerValidation.errors.join("\n- ")}`);
  }

  const rng = options.rng ?? Math.random;
  const runtime = createRuntime({
    cards,
    state: options.state ? restoreState(options.state) : undefined,
    rng
  });

  const session = {
    get turn() {
      return runtime.state.turn;
    },

    get factions() {
      return cloneJsonSafe(runtime.state.factions, "Session factions");
    },

    get gameOver() {
      return runtime.state.gameOver ? cloneJsonSafe(runtime.state.gameOver, "Session game over") : null;
    },

    get currentCard() {
      const card = runtime.cards.find((candidate) => candidate.id === runtime.state.currentCardId) ?? null;
      return card ? localizeCard(card, { locale, i18n }) : null;
    },

    get events() {
      return cloneJsonSafe(runtime.events, "Session events");
    },

    get locale() {
      return locale;
    },

    setLocale(nextLocale) {
      locale = resolveLocale(nextLocale, i18n);
      return locale;
    },

    state() {
      return serializeState(runtime.state);
    },

    start() {
      if (runtime.state.gameOver) {
        return session.currentCard;
      }
      if (runtime.state.currentCardId) {
        return session.currentCard;
      }
      return session.draw();
    },

    draw() {
      const card = runtime.draw();
      return card ? localizeCard(card, { locale, i18n }) : null;
    },

    swipe(direction) {
      if (!PLAYER_CHOICE_IDS.has(direction)) {
        throw new InterfaceError(`Swipe direction must be 'left' or 'right'`);
      }
      const result = runtime.choose(direction);
      return {
        choice: direction,
        factions: cloneJsonSafe(runtime.state.factions, "Session factions"),
        gameOver: runtime.state.gameOver ? cloneJsonSafe(runtime.state.gameOver, "Session game over") : null,
        nextCard: result.nextCard ? localizeCard(result.nextCard, { locale, i18n }) : null
      };
    },

    restore(snapshot) {
      const next = createPlaySession({ cards, state: snapshot, rng, i18n, locale });
      return next;
    }
  };

  return session;
}

/**
 * runDiagnostics runs the headless reviewer and returns a render-ready projection.
 */
export function runDiagnostics({ cards, metadata = {}, cycles = 1000, maxTurns = 50, seed = 1, thresholds }) {
  const reviewOptions = { cards: cloneCards(cards), cycles, maxTurns, seed };
  if (thresholds) {
    reviewOptions.thresholds = cloneJsonSafe(thresholds, "Reviewer thresholds");
  }
  return summarizeDiagnostics(runMonteCarloReview(reviewOptions), { cards, metadata });
}

/**
 * getCardGraph runs the static card-graph analysis (no Monte Carlo simulation)
 * and returns the per-choice directed graph for the story panel: nodes, edges
 * with the source choice(s) that enable each transition, plus reachability.
 * It is fast and safe to call on every editor change.
 */
export function getCardGraph({ cards, initialState = {} }) {
  return analyzeCardGraph(cloneCards(cards), initialState);
}

/**
 * deriveTagCatalog scans every card's requirements and choice effects to build
 * a creator-facing directory of the tags in use. For each tag key it records
 * where the tag is produced (which card/choice sets it) and where it is
 * required (which card gates on it, and via which match mode). Display labels
 * come from metadata.tagLabels; missing labels fall back to null so the UI can
 * show the raw key. This is a read-only derivation and never mutates cards.
 */
export function deriveTagCatalog({ cards, metadata = {} }) {
  const cloned = cloneCards(cards);
  const labels = metadata?.tagLabels ?? {};
  const entries = new Map();

  function ensure(key) {
    if (!entries.has(key)) {
      entries.set(key, {
        key,
        label: typeof labels[key] === "string" && labels[key].length > 0 ? labels[key] : null,
        producedBy: [],
        requiredBy: []
      });
    }
    return entries.get(key);
  }

  for (const card of cloned) {
    const requirements = card.requirements ?? {};
    for (const key of requirements.allTags ?? []) {
      ensure(key).requiredBy.push({ cardId: card.id, mode: "all" });
    }
    for (const key of requirements.anyTags ?? []) {
      ensure(key).requiredBy.push({ cardId: card.id, mode: "any" });
    }
    for (const key of requirements.noneTags ?? []) {
      ensure(key).requiredBy.push({ cardId: card.id, mode: "none" });
    }

    for (const choice of card.choices ?? []) {
      const tags = choice.effects?.tags ?? {};
      for (const [key, value] of Object.entries(tags)) {
        // A tag is "produced" only when the choice sets it truthy.
        if (value !== false && value !== null && value !== undefined) {
          ensure(key).producedBy.push({ cardId: card.id, choiceId: choice.id });
        }
      }
    }
  }

  const tags = [...entries.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { schemaVersion: 1, tags };
}

/**
 * deriveStoryGroups projects metadata.story.groups into a creator-facing
 * organization layer. Groups are data labels only: they do not alter runtime
 * scheduling, card eligibility, or player-facing rules.
 */
export function deriveStoryGroups({ cards, metadata = {} }) {
  const cloned = cloneCards(cards);
  const groups = Array.isArray(metadata?.story?.groups) ? metadata.story.groups : [];
  const cardTags = new Map(cloned.map((card) => [card.id, collectCardStoryTags(card)]));

  const projected = groups
    .filter((group) => group && typeof group === "object")
    .map((group, index) => {
      const id = isNonEmptyString(group.id) ? group.id : `group-${index + 1}`;
      const label = isNonEmptyString(group.label) ? group.label : id;
      const type = isNonEmptyString(group.type) ? group.type : "theme";
      const tags = normalizeStringList(group.tags ?? group.tagKeys ?? []);
      const explicitCardIds = normalizeStringList(group.cardIds ?? group.cards ?? []);
      const explicit = new Set(explicitCardIds);
      const tagSet = new Set(tags);
      const matchedCardIds = cloned
        .filter((card) => explicit.has(card.id) || [...(cardTags.get(card.id) ?? [])].some((tag) => tagSet.has(tag)))
        .map((card) => card.id);

      return {
        id,
        label,
        type,
        description: isNonEmptyString(group.description) ? group.description : null,
        tags,
        explicitCardIds,
        cardIds: matchedCardIds,
        cardCount: matchedCardIds.length,
        color: isNonEmptyString(group.color) ? group.color : null
      };
    });

  return { schemaVersion: 1, groups: projected };
}

/**
 * summarizeDiagnostics projects a raw reviewer report into a dashboard-friendly
 * shape. It does not modify or re-simulate the report.
 */
export function summarizeDiagnostics(report, context = {}) {
  const summary = report?.summary ?? {};
  const diagnostics = report?.diagnostics ?? {};
  const graph = report?.graph ?? {};
  const coverage = report?.coverage ?? {};
  const warnings = diagnostics.warnings ?? [];
  const cycles = report?.parameters?.cycles ?? 0;
  const narrative = projectNarrativeDiagnostics({
    cards: context.cards ?? [],
    metadata: context.metadata ?? {},
    coverage,
    graph
  });

  return {
    schemaVersion: 1,
    module: report?.module ?? "ReignsAgent-Reviewer",
    sampleSize: cycles,
    healthScore: computeHealthScore(summary, warnings),
    headline: buildHeadline(summary, warnings),
    factions: projectFactions(summary, cycles),
    coverage: {
      averageTurns: round(summary.averageTurns ?? 0),
      gameOverRate: round(summary.gameOverRate ?? 0),
      stalledRate: round(summary.stalledRate ?? 0),
      cardVisitRates: coverage.cardVisitRates ?? {},
      cardCycleRates: coverage.cardCycleRates ?? {},
      choiceCycleRates: coverage.choiceCycleRates ?? {},
      unvisitedCards: coverage.unvisitedCards ?? [],
      lowCycleCards: coverage.lowCycleCards ?? []
    },
    graph: {
      reachableCards: graph.reachableCards ?? [],
      unreachableCards: graph.unreachableCards ?? [],
      unsatisfiedRequiredTags: graph.unsatisfiedRequiredTags ?? [],
      unsatisfiedRequiredVariables: graph.unsatisfiedRequiredVariables ?? [],
      unsatisfiedRequiredFactions: graph.unsatisfiedRequiredFactions ?? []
    },
    narrative,
    warnings: warnings.map(projectWarning),
    warningCounts: diagnostics.warningCounts ?? { error: 0, warning: 0, info: 0 }
  };
}

/**
 * summarizeFeedback projects a diagnostic feedback action plan into a
 * dashboard-friendly list of correction actions.
 */
export function summarizeFeedback(report) {
  const feedback = createDiagnosticFeedback(report);
  return {
    schemaVersion: 1,
    sourceModule: feedback.sourceModule,
    summary: feedback.summary,
    actions: feedback.actions.map((action) => ({
      type: action.type,
      severity: action.severity,
      target: action.target,
      reason: action.reason,
      sourceWarning: action.sourceWarning
    }))
  };
}

/**
 * createConnectorConfig builds a descriptor for how the creator wants AI generation
 * configured. It stores no secrets: apiKey is referenced by name only, never copied
 * into build artifacts. The pipeline connector still owns the actual network call.
 */
export function createConnectorConfig(config) {
  assertPlainRecord(config, "Connector config");
  if (!isNonEmptyString(config.provider)) {
    throw new InterfaceError("Connector config requires a provider");
  }
  if (config.theme !== undefined && !isNonEmptyString(config.theme)) {
    throw new InterfaceError("Connector config theme must be a non-empty string");
  }

  const cardCount = config.cardCount ?? 8;
  if (!Number.isInteger(cardCount) || cardCount <= 0) {
    throw new InterfaceError("Connector config cardCount must be a positive integer");
  }

  const style = config.style ?? "minimal monochrome card portrait";

  const descriptor = {
    schemaVersion: 1,
    provider: config.provider,
    theme: config.theme ?? "untitled",
    cardCount,
    style,
    apiKeyRef: isNonEmptyString(config.apiKeyRef) ? config.apiKeyRef : null,
    endpoint: isNonEmptyString(config.endpoint) ? config.endpoint : null,
    modelId: isNonEmptyString(config.modelId) ? config.modelId : null,
    capabilities: Array.isArray(config.capabilities)
      ? config.capabilities.filter((capability) => isNonEmptyString(capability))
      : []
  };

  return descriptor;
}

/**
 * buildGenerationPlan turns a connector config into the pipeline request that the
 * creator dashboard can preview before any AI call is dispatched.
 */
export function buildGenerationPlan({ config, diagnostics = null }) {
  const descriptor = config?.schemaVersion === 1 ? config : createConnectorConfig(config);
  const request = buildCardGenerationRequest({
    theme: descriptor.theme,
    count: descriptor.cardCount,
    diagnostics
  });

  return {
    schemaVersion: 1,
    config: descriptor,
    request
  };
}

function normalizeAiEditConnectorConfig(config) {
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const descriptor = cloneJsonSafe(source, "AI edit config");
  delete descriptor.apiKey;
  delete descriptor.credentials;
  return {
    ...descriptor,
    provider: isNonEmptyString(descriptor.provider) ? descriptor.provider : "stub",
    endpoint: isNonEmptyString(descriptor.endpoint) ? descriptor.endpoint : null,
    modelId: isNonEmptyString(descriptor.modelId) ? descriptor.modelId : null,
    apiKeyRef: isNonEmptyString(descriptor.apiKeyRef) ? descriptor.apiKeyRef : null,
    capabilities: Array.isArray(descriptor.capabilities)
      ? descriptor.capabilities.filter((capability) => isNonEmptyString(capability))
      : []
  };
}

function shouldUseAiEndpoint(config) {
  return (
    isNonEmptyString(config.endpoint) &&
    isNonEmptyString(config.modelId) &&
    config.provider !== "stub" &&
    config.provider !== "local-stub"
  );
}

export function buildAiEditPlan({ editor, config = {}, mode = "generate_cards", instruction = "", targetCardId = null, assetId = null, diagnostics = null }) {
  const bundle = editor?.toBundle ? editor.toBundle() : createContentBundle(editor ?? {});
  const descriptor = normalizeAiEditConnectorConfig(config);
  return createAiEditSuggestions({
    bundle,
    mode,
    config: descriptor,
    instruction,
    targetCardId,
    assetId,
    diagnostics
  });
}

export async function buildAiEditPlanAsync({
  editor,
  config = {},
  credentials = {},
  mode = "generate_cards",
  instruction = "",
  targetCardId = null,
  assetId = null,
  diagnostics = null,
  fetchImpl = globalThis.fetch
}) {
  const bundle = editor?.toBundle ? editor.toBundle() : createContentBundle(editor ?? {});
  const descriptor = normalizeAiEditConnectorConfig(config);
  if (!shouldUseAiEndpoint(descriptor)) {
    return createAiEditSuggestions({
      bundle,
      mode,
      config: descriptor,
      instruction,
      targetCardId,
      assetId,
      diagnostics
    });
  }

  return createAiEditSuggestionsFromEndpoint({
    bundle,
    mode,
    config: descriptor,
    credentials,
    instruction,
    targetCardId,
    assetId,
    diagnostics,
    fetchImpl
  });
}

export function applyAiEditPlan({ editor, plan, proposalIds = [] }) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new InterfaceError("AI edit plan must be an object");
  }
  const bundle = editor?.toBundle ? editor.toBundle() : createContentBundle(editor ?? {});
  const currentFingerprint = createAiEditSuggestions({
    bundle,
    mode: "generate_cards",
    config: { cardCount: 1 },
    instruction: ""
  }).baseFingerprint;

  if (plan.baseFingerprint !== currentFingerprint) {
    throw new InterfaceError("AI edit plan is stale; rebuild the plan before applying proposals");
  }

  const selectedIds = normalizeStringList(proposalIds);
  const selectedSet = new Set(selectedIds);
  const proposals = Array.isArray(plan.proposals) ? plan.proposals : [];
  const selected = selectedIds.length > 0
    ? proposals.filter((proposal) => selectedSet.has(proposal.id))
    : proposals;

  if (selected.length === 0) {
    throw new InterfaceError("Select at least one AI edit proposal to apply");
  }

  const patches = selected.flatMap((proposal) => Array.isArray(proposal.patches) ? proposal.patches : []);
  const applied = applyAiEditPatches({ bundle, patches });
  const nextEditor = createCardEditor({
    cards: applied.bundle.cards,
    metadata: applied.bundle.metadata,
    assets: applied.bundle.assets
  });
  const playerValidation = nextEditor.validateForPlayer();

  return {
    applied: true,
    proposalIds: selected.map((proposal) => proposal.id),
    patchCount: patches.length,
    bundle: nextEditor.toBundle(),
    validation: applied.validation,
    playerValidation,
    editor: nextEditor
  };
}

/**
 * prepareGameBuild assembles a deployable, self-contained game build manifest.
 * It bundles content + a player schema so the deployable player (built by the
 * build-game script) only needs the headless core to run.
 */
export function prepareGameBuild({ editor, config = null, buildId = null }) {
  const bundle = editor?.toBundle ? editor.toBundle() : createContentBundle(editor ?? {});
  const i18n = createI18nCatalog(bundle.metadata?.i18n ?? {});
  const presentation = normalizePresentationConfig(bundle.metadata?.presentation ?? {});
  const playerValidation = validatePlayerCards(bundle.cards);
  if (!playerValidation.valid) {
    throw new InterfaceError(`Cannot build: player cards are invalid:\n- ${playerValidation.errors.join("\n- ")}`);
  }

  const build = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: isNonEmptyString(buildId) ? buildId : createBuildId(bundle),
    createdAt: null,
    title: bundle.metadata?.title ?? "Untitled Reigns Deck",
    version: bundle.metadata?.version ?? "0.0.0",
    player: {
      schemaVersion: PLAYER_SCHEMA_VERSION,
      choiceModel: "binary",
      factions: [...FACTIONS],
      i18n
    },
    presentation,
    content: bundle,
    config: config ? cloneJsonSafe(config, "Build config") : null
  };

  return build;
}

/**
 * serializeBuild turns a prepared build into stable JSON for the deployable file.
 */
export function serializeBuild(build) {
  assertPlainRecord(build, "Game build");
  const withTimestamp = {
    ...build,
    createdAt: isNonEmptyString(build.createdAt) ? build.createdAt : new Date(0).toISOString()
  };
  return `${JSON.stringify(withTimestamp, null, 2)}\n`;
}

/**
 * projectFactionGauges turns a factions map into left/right meter data the
 * dashboard can render without knowing the engine internals.
 */
export function projectFactionGauges(factions, presentation = {}) {
  assertPlainRecord(factions, "Factions");
  const gaugePresentation = normalizeGaugePresentation(presentation?.presentation?.gauges ?? presentation?.gauges ?? {});
  const gauges = {};
  for (const faction of FACTIONS) {
    const config = gaugePresentation[faction] ?? {};
    if (config.visible === false) continue;
    const raw = factions[faction];
    const value = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 50;
    gauges[faction] = {
      key: faction,
      label: config.label ?? null,
      description: config.description ?? null,
      visible: true,
      value,
      left: value,
      right: 100 - value
    };
  }
  return gauges;
}

/* ------------------------------------------------------------------ helpers */

function cloneCards(cards) {
  if (!Array.isArray(cards)) {
    throw new InterfaceError("Cards must be an array");
  }
  return normalizeCards(cloneJsonSafe(cards, "Cards"));
}

function requireCard(cards, cardId) {
  const card = cards.find((candidate) => candidate.id === cardId);
  if (!card) {
    throw new InterfaceError(`Card '${cardId}' was not found`);
  }
  return card;
}

function requireChoice(card, choiceId) {
  if (!Array.isArray(card.choices)) {
    throw new InterfaceError(`Card '${card.id}' has no choices`);
  }
  const choice = card.choices.find((candidate) => candidate.id === choiceId);
  if (!choice) {
    throw new InterfaceError(`Choice '${choiceId}' was not found on card '${card.id}'`);
  }
  return choice;
}

function pickLocaleEntry(entries, locale, defaultLocale) {
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return null;
  }

  return entries[locale] ?? entries[locale?.split("-")[0]] ?? entries[defaultLocale] ?? null;
}

function normalizeCssVariables(variables) {
  assertPlainRecord(variables, "Presentation css variables");
  const result = {};

  for (const [name, value] of Object.entries(variables)) {
    if (!name.startsWith("--")) {
      throw new InterfaceError(`CSS variable '${name}' must start with --`);
    }
    if (typeof value !== "string" && typeof value !== "number") {
      throw new InterfaceError(`CSS variable '${name}' must be a string or number`);
    }
    result[name] = String(value);
  }

  return result;
}

function normalizeGaugePresentation(value) {
  assertPlainRecord(value, "Presentation gauges");
  const gauges = {};
  const sources = {};

  for (const [key, raw] of Object.entries(value)) {
    let gaugeKey;
    try {
      gaugeKey = normalizeFactionKey(key);
    } catch {
      throw new InterfaceError(`Presentation gauge '${key}' must be one of: ${FACTIONS.join(", ")}`);
    }
    if (sources[gaugeKey] !== undefined) {
      throw new InterfaceError(`Presentation gauges define both '${sources[gaugeKey]}' and '${key}' for '${gaugeKey}'`);
    }
    sources[gaugeKey] = key;
    assertPlainRecord(raw, `Presentation gauge '${key}'`);

    const entry = {};
    if (raw.label !== undefined) {
      if (typeof raw.label !== "string") {
        throw new InterfaceError(`Presentation gauge '${key}' label must be a string`);
      }
      const label = raw.label.trim();
      if (label) entry.label = label;
    }
    if (raw.description !== undefined) {
      if (typeof raw.description !== "string") {
        throw new InterfaceError(`Presentation gauge '${key}' description must be a string`);
      }
      const description = raw.description.trim();
      if (description) entry.description = description;
    }
    if (raw.visible !== undefined && typeof raw.visible !== "boolean") {
      throw new InterfaceError(`Presentation gauge '${key}' visible must be a boolean`);
    }
    if (raw.hidden !== undefined && typeof raw.hidden !== "boolean") {
      throw new InterfaceError(`Presentation gauge '${key}' hidden must be a boolean`);
    }

    entry.visible = raw.hidden === true ? false : raw.visible !== false;
    gauges[gaugeKey] = entry;
  }

  return gauges;
}

function normalizePresentationPolicy(policy) {
  assertPlainRecord(policy, "Presentation policy");
  return {
    allowCssText: Boolean(policy.allowCssText),
    allowHtml: Boolean(policy.allowHtml),
    allowJs: Boolean(policy.allowJs)
  };
}

function normalizeStringSlots(slots) {
  assertPlainRecord(slots, "Presentation slots");
  const result = {};

  for (const [name, value] of Object.entries(slots)) {
    if (!isNonEmptyString(name)) {
      throw new InterfaceError("Presentation slot names must be non-empty strings");
    }
    if (typeof value !== "string") {
      throw new InterfaceError(`Presentation slot '${name}' must be a string`);
    }
    result[name] = value;
  }

  return result;
}

function computeHealthScore(summary, warnings) {
  let score = 100;
  score -= (summary.gameOverRate ?? 0) * 35;
  score -= (summary.stalledRate ?? 0) * 25;
  score -= warnings.filter((warning) => warning.severity === "error").length * 8;
  score -= warnings.filter((warning) => warning.severity === "warning").length * 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildHeadline(summary, warnings) {
  const errorCount = warnings.filter((warning) => warning.severity === "error").length;
  if (errorCount > 0) {
    return `${errorCount} blocking issue${errorCount === 1 ? "" : "s"} found`;
  }
  if ((summary.stalledRate ?? 0) > 0) {
    return "Some cycles stalled without a card";
  }
  if ((summary.gameOverRate ?? 0) > 0.8) {
    return "Most cycles end quickly; consider rebalancing";
  }
  return "Deck is playable";
}

function projectFactions(summary, cycles) {
  const averages = summary.factionAverages ?? {};
  const byFaction = summary.gameOverByFaction ?? {};
  return FACTIONS.map((faction) => {
    const count = byFaction[faction] ?? 0;
    return {
      faction,
      average: round(averages[faction] ?? 50),
      gameOverShare: round(cycles > 0 ? count / cycles : 0)
    };
  });
}

function projectWarning(warning) {
  return {
    code: warning.code,
    severity: warning.severity,
    message: warning.message,
    details: pickWarningDetails(warning)
  };
}

function projectNarrativeDiagnostics({ cards, metadata, coverage, graph }) {
  const groups = deriveStoryGroups({ cards, metadata }).groups;
  const cardVisitRates = coverage.cardVisitRates ?? {};
  const cardCycleRates = coverage.cardCycleRates ?? {};
  const unreachableSet = new Set(graph.unreachableCards ?? []);
  const lowCycleByCard = new Map((coverage.lowCycleCards ?? []).map((entry) => [entry.cardId, entry.rate ?? 0]));

  const storyGroups = groups.map((group) => projectStoryGroupCoverage({
    group,
    cardVisitRates,
    cardCycleRates,
    unreachableSet,
    lowCycleByCard
  }));
  const issues = storyGroups.flatMap(projectStoryGroupIssues);
  const endingGroups = storyGroups.filter((group) => group.type.toLowerCase() === "ending");

  return {
    schemaVersion: 1,
    summary: {
      groupCount: storyGroups.length,
      coveredGroupCount: storyGroups.filter((group) => group.status === "covered").length,
      partialGroupCount: storyGroups.filter((group) => group.status === "partial").length,
      unvisitedGroupCount: storyGroups.filter((group) => group.status === "unvisited" || group.status === "unreachable").length,
      emptyGroupCount: storyGroups.filter((group) => group.status === "empty").length,
      endingGroupCount: endingGroups.length,
      coveredEndingGroupCount: endingGroups.filter((group) => group.status === "covered").length,
      issueCount: issues.length
    },
    storyGroups,
    issues
  };
}

function projectStoryGroupCoverage({ group, cardVisitRates, cardCycleRates, unreachableSet, lowCycleByCard }) {
  const cardIds = group.cardIds ?? [];
  const visitedCardIds = cardIds.filter((cardId) => (cardVisitRates[cardId] ?? 0) > 0);
  const unvisitedCardIds = cardIds.filter((cardId) => (cardVisitRates[cardId] ?? 0) <= 0);
  const unreachableCardIds = cardIds.filter((cardId) => unreachableSet.has(cardId));
  const lowCycleCards = cardIds
    .filter((cardId) => lowCycleByCard.has(cardId))
    .map((cardId) => ({ cardId, rate: round(lowCycleByCard.get(cardId) ?? 0) }));
  const coverageRate = cardIds.length > 0 ? visitedCardIds.length / cardIds.length : 0;
  const averageCycleRate = averageRate(cardIds, cardCycleRates);
  const status = storyGroupStatus({
    cardCount: cardIds.length,
    visitedCount: visitedCardIds.length,
    unvisitedCount: unvisitedCardIds.length,
    unreachableCount: unreachableCardIds.length,
    lowCycleCount: lowCycleCards.length
  });

  return {
    id: group.id,
    label: group.label,
    type: group.type,
    description: group.description,
    tags: group.tags,
    cardIds,
    cardCount: cardIds.length,
    visitedCardIds,
    unvisitedCardIds,
    unreachableCardIds,
    lowCycleCards,
    coverageRate: round(coverageRate),
    averageCycleRate,
    status,
    tone: storyGroupTone(status)
  };
}

function projectStoryGroupIssues(group) {
  if (group.status === "empty") {
    return [{
      code: "empty_story_group",
      severity: "warning",
      groupId: group.id,
      message: `${group.label} has no matching cards.`
    }];
  }

  if (group.status === "unreachable") {
    return [{
      code: "unreachable_story_group",
      severity: "error",
      groupId: group.id,
      cardIds: group.unreachableCardIds,
      message: `${group.label} cannot be reached from the current graph.`
    }];
  }

  if (group.status === "unvisited") {
    return [{
      code: group.type.toLowerCase() === "ending" ? "unvisited_ending_group" : "unvisited_story_group",
      severity: "error",
      groupId: group.id,
      cardIds: group.unvisitedCardIds,
      message: `${group.label} was never reached in this review run.`
    }];
  }

  if (group.status === "partial") {
    return [{
      code: group.type.toLowerCase() === "ending" ? "partial_ending_group_coverage" : "partial_story_group_coverage",
      severity: "warning",
      groupId: group.id,
      cardIds: group.unvisitedCardIds,
      lowCycleCards: group.lowCycleCards,
      message: `${group.label} has partial or low simulation coverage.`
    }];
  }

  return [];
}

function storyGroupStatus({ cardCount, visitedCount, unvisitedCount, unreachableCount, lowCycleCount }) {
  if (cardCount === 0) return "empty";
  if (unreachableCount === cardCount) return "unreachable";
  if (visitedCount === 0) return "unvisited";
  if (unvisitedCount > 0 || lowCycleCount > 0) return "partial";
  return "covered";
}

function storyGroupTone(status) {
  if (status === "covered") return "good";
  if (status === "partial" || status === "empty") return "warn";
  return "bad";
}

function averageRate(cardIds, rates) {
  if (cardIds.length === 0) return 0;
  return round(cardIds.reduce((total, cardId) => total + (rates[cardId] ?? 0), 0) / cardIds.length);
}

function pickWarningDetails(warning) {
  const keys = ["cardIds", "cards", "tags", "variables", "factions", "faction", "rate", "threshold", "cycles"];
  const details = {};
  for (const key of keys) {
    if (warning[key] !== undefined) {
      details[key] = cloneJsonSafe(warning[key], `Warning '${warning.code}' ${key}`);
    }
  }
  return details;
}

function collectCardStoryTags(card) {
  const tags = new Set();
  const requirements = card.requirements ?? {};
  for (const key of requirements.allTags ?? []) tags.add(key);
  for (const key of requirements.anyTags ?? []) tags.add(key);
  for (const key of requirements.noneTags ?? []) tags.add(key);

  for (const choice of card.choices ?? []) {
    for (const [key, value] of Object.entries(choice.effects?.tags ?? {})) {
      if (value !== false && value !== null && value !== undefined) tags.add(key);
    }
  }
  return tags;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => (typeof entry === "string" ? entry.trim() : entry)).filter(isNonEmptyString))];
}

function createBuildId(bundle) {
  const title = bundle.metadata?.title ?? "untitled";
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "deck";
  const stamp = Date.now().toString(36);
  return `${slug}-${stamp}`;
}

function round(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 10000) / 10000;
}

function assertPlainRecord(value, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InterfaceError(`${context} must be an object`);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function cloneJsonSafe(value, context) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InterfaceError(`${context} must contain only finite numbers`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneJsonSafe(entry, `${context}[${index}]`));
  }
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const clone = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) {
        throw new InterfaceError(`${context}.${key} must not be undefined`);
      }
      clone[key] = cloneJsonSafe(entry, `${context}.${key}`);
    }
    return clone;
  }
  throw new InterfaceError(`${context} must be JSON-safe`);
}
