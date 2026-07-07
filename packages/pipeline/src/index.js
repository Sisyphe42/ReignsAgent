import { readFile, writeFile } from "node:fs/promises";

const CONTENT_SCHEMA_VERSION = 1;
const CSV_COLUMNS = [
  "cardId",
  "text",
  "weight",
  "requirementsJson",
  "choiceId",
  "choiceLabel",
  "effectsJson"
];
const PIPELINE_FACTIONS = new Set(["gauge0", "gauge1", "gauge2", "gauge3"]);
const LEGACY_FACTION_KEYS = Object.freeze({
  faith: "gauge0",
  people: "gauge1",
  military: "gauge2",
  treasury: "gauge3"
});
const REQUIREMENT_KEYS = new Set(["allTags", "anyTags", "noneTags", "variables", "factions"]);
const EFFECT_KEYS = new Set(["tags", "variables", "factions", "activateHooks", "dismissHooks"]);
const AI_EDIT_SCHEMA_VERSION = 1;
const AI_EDIT_MODES = new Set(["generate_cards", "repair_diagnostics", "generate_asset", "analyze_asset"]);
const AI_EDIT_PATCH_OPS = new Set(["addCard", "updateCard", "setChoiceLabel", "setChoiceEffects", "setMetadata", "upsertAsset"]);
const AI_ENDPOINT_ROUTES = {
  openai_responses: "/responses",
  openai_chat: "/chat/completions",
  openai_completions: "/completions",
  anthropic_messages: "/messages"
};
const AI_ENDPOINT_PROTOCOL_ALIASES = {
  responses: "openai_responses",
  messages: "openai_chat",
  completions: "openai_completions"
};
const AI_ENDPOINT_ROUTE_MODES = new Set(["auto", "api_root", "full_url"]);

export function createContentBundle({ cards, metadata = {}, assets = [] }) {
  const normalizedCards = normalizeCards(cards);
  const validation = validateContentBundle({ schemaVersion: CONTENT_SCHEMA_VERSION, metadata, cards: normalizedCards, assets });

  if (!validation.valid) {
    throw new PipelineError(`Content bundle validation failed:\n- ${validation.errors.join("\n- ")}`);
  }

  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    metadata: normalizeMetadata(metadata),
    cards: normalizedCards,
    assets: normalizeAssets(assets)
  };
}

export async function readCardsJson(path) {
  const contents = await readFile(path, "utf8");
  return parseCardsJson(contents);
}

export async function writeCardsJson(path, cards) {
  await writeFile(path, stringifyCardsJson(cards), "utf8");
}

export function parseCardsJson(source) {
  const data = parseJsonSource(source, "JSON card data");
  const cards = Array.isArray(data) ? data : data?.cards;

  if (!Array.isArray(cards)) {
    throw new PipelineError("JSON card data must be an array or an object with a cards array");
  }

  return normalizeCards(cards);
}

export function stringifyCardsJson(cards) {
  return `${JSON.stringify({ cards: normalizeCards(cards) }, null, 2)}\n`;
}

export async function readContentJson(path) {
  const contents = await readFile(path, "utf8");
  return parseContentJson(contents);
}

export async function writeContentJson(path, bundle) {
  await writeFile(path, stringifyContentJson(bundle), "utf8");
}

export function parseContentJson(source) {
  const data = parseJsonSource(source, "JSON content bundle");
  const bundle = Array.isArray(data)
    ? createContentBundle({ cards: data })
    : createContentBundle({
        metadata: data.metadata ?? {},
        cards: data.cards,
        assets: data.assets ?? []
      });

  return bundle;
}

export function stringifyContentJson(bundle) {
  return `${JSON.stringify(createContentBundle(bundle), null, 2)}\n`;
}

export async function readCardsCsv(path) {
  const contents = await readFile(path, "utf8");
  return parseCardsCsv(contents);
}

export async function writeCardsCsv(path, cards) {
  await writeFile(path, stringifyCardsCsv(cards), "utf8");
}

export function parseCardsCsv(source) {
  const rows = parseCsvRows(source);
  if (rows.length === 0) {
    return [];
  }

  const [header, ...body] = rows;
  const columnIndexes = Object.fromEntries(header.map((name, index) => [name, index]));
  for (const column of CSV_COLUMNS) {
    if (!(column in columnIndexes)) {
      throw new PipelineError(`CSV is missing required column '${column}'`);
    }
  }

  const cards = new Map();
  for (const row of body) {
    if (row.every((cell) => cell === "")) {
      continue;
    }

    const cardId = cell(row, columnIndexes.cardId);
    const choice = {
      id: cell(row, columnIndexes.choiceId),
      label: cell(row, columnIndexes.choiceLabel),
      effects: parseJsonCell(cell(row, columnIndexes.effectsJson), "effectsJson")
    };

    if (!cards.has(cardId)) {
      cards.set(cardId, {
        id: cardId,
        text: cell(row, columnIndexes.text),
        weight: parseWeight(cell(row, columnIndexes.weight)),
        requirements: parseJsonCell(cell(row, columnIndexes.requirementsJson), "requirementsJson"),
        choices: []
      });
    }

    cards.get(cardId).choices.push(choice);
  }

  return normalizeCards([...cards.values()]);
}

export function stringifyCardsCsv(cards) {
  const rows = [CSV_COLUMNS];

  for (const card of normalizeCards(cards)) {
    for (const choice of card.choices) {
      rows.push([
        card.id,
        card.text ?? "",
        String(card.weight ?? 1),
        JSON.stringify(card.requirements ?? {}),
        choice.id,
        choice.label ?? "",
        JSON.stringify(choice.effects ?? {})
      ]);
    }
  }

  return `${rows.map(formatCsvRow).join("\n")}\n`;
}

export function validateCardSet(cards) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(cards)) {
    return {
      valid: false,
      errors: ["Card data must be an array"],
      warnings
    };
  }

  const seenCardIds = new Set();
  for (const [cardIndex, card] of cards.entries()) {
    validateCard(card, cardIndex, seenCardIds, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export function assertValidCardSet(cards) {
  const validation = validateCardSet(cards);

  if (!validation.valid) {
    throw new PipelineError(`Card data validation failed:\n- ${validation.errors.join("\n- ")}`);
  }

  return validation;
}

export function validateContentBundle(bundle) {
  const errors = [];
  const warnings = [];

  if (!isPlainRecord(bundle)) {
    return {
      valid: false,
      errors: ["Content bundle must be an object"],
      warnings
    };
  }

  if (bundle.schemaVersion !== undefined && bundle.schemaVersion !== CONTENT_SCHEMA_VERSION) {
    errors.push(`Unsupported content schemaVersion '${bundle.schemaVersion}'`);
  }

  if (bundle.metadata !== undefined && !isPlainRecord(bundle.metadata)) {
    errors.push("Content bundle metadata must be an object");
  }

  const cardValidation = validateCardSet(bundle.cards);
  errors.push(...cardValidation.errors);
  warnings.push(...cardValidation.warnings);

  if (bundle.assets !== undefined) {
    validateAssets(bundle.assets, errors);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export function createLLMConnector(connector) {
  if (!connector?.name) {
    throw new PipelineError("Connector requires a name");
  }

  if (typeof connector.generateText !== "function") {
    throw new PipelineError("Connector requires generateText(request)");
  }

  if (connector.generateAsset !== undefined && typeof connector.generateAsset !== "function") {
    throw new PipelineError("Connector generateAsset must be a function when provided");
  }

  return {
    name: connector.name,
    generateText: connector.generateText,
    generateAsset: connector.generateAsset
  };
}

export async function generateCardDrafts({ connector, theme, count, constraints = {}, diagnostics = null }) {
  const llm = createLLMConnector(connector);
  const request = buildCardGenerationRequest({ theme, count, constraints, diagnostics });
  const response = await llm.generateText(request);

  return parseCardsJson(extractTextPayload(response));
}

export async function generateAssetDrafts({ connector, cards, style = "minimal monochrome card portrait" }) {
  const llm = createLLMConnector(connector);

  if (typeof llm.generateAsset !== "function") {
    throw new PipelineError("Connector requires generateAsset(request) for asset generation");
  }

  const assets = [];
  for (const card of normalizeCards(cards)) {
    const request = buildAssetGenerationRequest({ card, style });
    assets.push(
      await llm.generateAsset(request)
    );
  }

  return assets;
}

export function createDiagnosticFeedback(report) {
  const warnings = report?.diagnostics?.warnings ?? report?.warnings ?? [];
  const actions = [];
  const seenActions = new Set();

  for (const warning of warnings) {
    const warningDetails = warning.details ?? {};
    if (warning.code === "never_visited_cards") {
      addAction(actions, seenActions, {
        type: "relax_requirements",
        severity: warning.severity ?? "error",
        target: warning.cardIds ?? warningDetails.cardIds ?? [],
        reason: warning.message,
        sourceWarning: warning.code
      });
    }

    if (warning.code === "unreachable_cards") {
      addAction(actions, seenActions, {
        type: "repair_reachability",
        severity: warning.severity ?? "error",
        target: warning.cardIds ?? warningDetails.cardIds ?? [],
        reason: warning.message,
        sourceWarning: warning.code
      });
    }

    if (warning.code === "low_card_cycle_coverage") {
      addAction(actions, seenActions, {
        type: "raise_card_exposure",
        severity: warning.severity ?? "warning",
        target: (warning.cards ?? warningDetails.cards ?? []).map((card) => card.cardId),
        reason: warning.message,
        sourceWarning: warning.code
      });
    }

    if (warning.code === "unsatisfied_required_tags") {
      addAction(actions, seenActions, {
        type: "add_tag_producers",
        severity: warning.severity ?? "error",
        target: warning.tags ?? warningDetails.tags ?? [],
        reason: warning.message,
        sourceWarning: warning.code
      });
    }

    if (warning.code === "unsatisfied_required_variables") {
      addAction(actions, seenActions, {
        type: "add_variable_producers",
        severity: warning.severity ?? "error",
        target: warning.variables ?? warningDetails.variables ?? [],
        reason: warning.message,
        sourceWarning: warning.code
      });
    }

    if (warning.code === "unsatisfied_required_factions") {
      addAction(actions, seenActions, {
        type: "adjust_faction_requirements",
        severity: warning.severity ?? "error",
        target: warning.factions ?? warningDetails.factions ?? [],
        reason: warning.message,
        sourceWarning: warning.code
      });
    }

    if (warning.code === "stalled_cycles") {
      addAction(actions, seenActions, {
        type: "add_fallback_cards",
        severity: warning.severity ?? "error",
        target: "scheduler",
        reason: warning.message,
        sourceWarning: warning.code
      });
    }

    if (warning.code === "dominant_game_over_faction" || warning.code === "high_game_over_rate") {
      addAction(actions, seenActions, {
        type: "rebalance_faction_pressure",
        severity: warning.severity ?? "warning",
        target: warning.faction ?? warningDetails.faction ?? "all",
        reason: warning.message,
        sourceWarning: warning.code
      });
    }
  }

  const gameOverByFaction = report?.summary?.gameOverByFaction ?? {};
  const cycles = report?.parameters?.cycles ?? 0;
  const hasModernBalanceWarning = warnings.some((warning) =>
    ["dominant_game_over_faction", "high_game_over_rate"].includes(warning.code)
  );
  if (!hasModernBalanceWarning) {
    for (const [faction, count] of Object.entries(gameOverByFaction)) {
      if (cycles > 0 && count / cycles > 0.45) {
        addAction(actions, seenActions, {
          type: "rebalance_faction_pressure",
          severity: "warning",
          target: faction,
          reason: `More than 45% of simulated endings hit ${faction}.`,
          sourceWarning: "legacy_game_over_balance"
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    sourceModule: report?.module ?? "ReignsAgent-Reviewer",
    summary: {
      actionCount: actions.length,
      errorCount: actions.filter((action) => action.severity === "error").length,
      warningCount: actions.filter((action) => action.severity === "warning").length
    },
    actions
  };
}

export function buildCardGenerationRequest({ theme, count, constraints = {}, diagnostics = null }) {
  const prompt = buildCardGenerationPrompt({ theme, count, constraints, diagnostics });

  return {
    requestId: createRequestId("card_generation", prompt),
    purpose: "card_generation",
    prompt,
    responseFormat: "json",
    schema: cardGenerationSchema(),
    metadata: {
      theme,
      count,
      hasDiagnostics: Boolean(diagnostics)
    }
  };
}

export function buildAssetGenerationRequest({ card, style = "minimal monochrome card portrait" }) {
  const normalizedCard = normalizeCard(card);
  const prompt = `${style}: ${normalizedCard.text ?? normalizedCard.id}`;

  return {
    requestId: createRequestId("card_asset_generation", `${normalizedCard.id}:${prompt}`),
    purpose: "card_asset_generation",
    cardId: normalizedCard.id,
    prompt,
    metadata: {
      style
    }
  };
}

export function buildAiContext({
  bundle,
  instruction = "",
  targetCardIds = [],
  diagnostics = null,
  constraints = {},
  assets = null,
  assetId = null,
  mode = "generate_cards"
}) {
  const normalizedBundle = createContentBundle(bundle);
  const selectedIds = normalizeStringArray(targetCardIds);
  const selectedSet = new Set(selectedIds);
  const selectedCards = normalizedBundle.cards.filter((card) => selectedSet.has(card.id));
  const linkedAssets = normalizedBundle.assets.filter((asset) =>
    selectedSet.has(asset.cardId) || (assetId && asset.id === assetId)
  );
  const suppliedAssets = Array.isArray(assets) ? assets.map((asset) => cloneJsonValue(asset, "AI context asset")) : [];

  return {
    schemaVersion: AI_EDIT_SCHEMA_VERSION,
    project: {
      product: "ReignsAgent Creator",
      usage: "Assist creators with card drafting, review repair, and future visual request workflows while preserving the authored content model.",
      gameplayRule: "The visible player loop is card text plus exactly two choices: left and right.",
      boundaryRule: "Use tags, variables, metadata, and creator-owned labels for story state. Do not invent built-in management loops or extra player-facing systems.",
      schemaExpectations: {
        card: ["id", "text", "weight", "requirements", "choices"],
        choiceIds: ["left", "right"],
        requirementKeys: [...REQUIREMENT_KEYS],
        effectKeys: [...EFFECT_KEYS],
        patchOps: [...AI_EDIT_PATCH_OPS]
      },
      responseExpectations: "Return JSON-ready proposals with explicit patch operations only. Do not call providers or reference external files."
    },
    mode,
    instruction: String(instruction ?? "").trim(),
    selection: {
      targetCardIds: selectedIds,
      cards: selectedCards.map(compactCardForAi),
      assetId: isNonEmptyString(assetId) ? assetId : null,
      linkedAssets: linkedAssets.map(compactAssetForAi),
      suppliedAssets: suppliedAssets.map(compactAssetForAi)
    },
    bundle: {
      fingerprint: createBundleFingerprint(normalizedBundle),
      metadata: {
        title: normalizedBundle.metadata.title ?? null,
        version: normalizedBundle.metadata.version ?? null,
        tagLabels: isPlainRecord(normalizedBundle.metadata.tagLabels) ? normalizedBundle.metadata.tagLabels : {},
        gauges: projectGaugeLabels(normalizedBundle.metadata)
      },
      cardCount: normalizedBundle.cards.length,
      assetCount: normalizedBundle.assets.length,
      cards: normalizedBundle.cards.slice(0, 12).map(compactCardForAi)
    },
    diagnostics: diagnostics ? compactDiagnosticsForAi(diagnostics) : null,
    constraints: cloneJsonValue(constraints ?? {}, "AI context constraints")
  };
}

export function buildCardEditRequest({ bundle, instruction = "", targetCardIds = [], diagnostics = null, constraints = {} }) {
  const context = buildAiContext({ bundle, instruction, targetCardIds, diagnostics, constraints, mode: "card_edit" });
  const prompt = [
    "Create ReignsAgent card-edit proposals from the supplied context.",
    `Creator instruction: ${context.instruction || "Use the current deck context."}`,
    "Respect the binary left/right choice model and return explicit patch operations."
  ].join("\n");

  return {
    requestId: createRequestId("card_edit", stableStringify(context)),
    purpose: "card_edit",
    prompt,
    responseFormat: "json",
    schema: aiEditProposalSchema(),
    context,
    metadata: {
      targetCardIds: context.selection.targetCardIds,
      hasDiagnostics: Boolean(diagnostics)
    }
  };
}

export function buildMediaEditRequest({
  bundle,
  mode,
  instruction = "",
  targetCardId = null,
  assetId = null,
  style = "",
  diagnostics = null,
  constraints = {}
}) {
  if (mode !== "generate_asset" && mode !== "analyze_asset") {
    throw new PipelineError("media AI edit mode must be generate_asset or analyze_asset");
  }

  const targetCardIds = isNonEmptyString(targetCardId) ? [targetCardId] : [];
  const purpose = mode === "generate_asset" ? "card_asset_generation" : "card_asset_analysis";
  const context = buildAiContext({
    bundle,
    instruction,
    targetCardIds,
    diagnostics,
    constraints: { ...constraints, style },
    assetId,
    mode
  });
  const targetCard = context.selection.cards[0];
  const prompt = [
    mode === "generate_asset" ? "Prepare a visual generation request for a card asset." : "Prepare a visual analysis request for a card asset.",
    `Card: ${targetCard?.id ?? "none selected"}`,
    `Style: ${style || "creator default"}`,
    `Creator instruction: ${context.instruction || "Use the selected context."}`
  ].join("\n");

  return {
    requestId: createRequestId(purpose, stableStringify(context)),
    purpose,
    mode,
    prompt,
    responseFormat: "json",
    schema: mode === "generate_asset" ? mediaGenerationPreviewSchema() : mediaAnalysisPreviewSchema(),
    context,
    metadata: {
      targetCardId: targetCard?.id ?? null,
      assetId: context.selection.assetId,
      style
    }
  };
}

function buildAiEndpointValidationRequest({ bundle }) {
  const context = buildAiContext({
    bundle,
    instruction: "Endpoint validation only. Return exactly {\"proposals\":[]} and do not propose edits.",
    targetCardIds: [],
    diagnostics: null,
    constraints: {
      validationOnly: true,
      expectedResponse: { proposals: [] }
    },
    mode: "generate_cards"
  });

  return {
    requestId: createRequestId("ai_endpoint_validation", stableStringify(context)),
    purpose: "ai_endpoint_validation",
    prompt: "Validate endpoint compatibility. Return exactly {\"proposals\":[]} with no markdown.",
    responseFormat: "json",
    schema: aiEditProposalSchema(),
    context,
    metadata: {
      validationOnly: true
    }
  };
}

export function createAiEditSuggestions({
  bundle,
  mode = "generate_cards",
  config = {},
  instruction = "",
  targetCardId = null,
  assetId = null,
  diagnostics = null
}) {
  if (!AI_EDIT_MODES.has(mode)) {
    throw new PipelineError(`Unknown AI edit mode '${mode}'`);
  }

  const normalizedBundle = createContentBundle(bundle);
  const descriptor = cloneJsonValue(config ?? {}, "AI edit config");
  const targetCardIds = isNonEmptyString(targetCardId) ? [targetCardId] : [];
  const style = isNonEmptyString(descriptor.style) ? descriptor.style : "editorial card art";
  const request = mode === "generate_asset" || mode === "analyze_asset"
    ? buildMediaEditRequest({ bundle: normalizedBundle, mode, instruction, targetCardId, assetId, style, diagnostics })
    : buildCardEditRequest({ bundle: normalizedBundle, instruction, targetCardIds, diagnostics, constraints: descriptor.constraints ?? {} });
  const feedback = diagnostics ? createDiagnosticFeedback(diagnostics) : null;
  const proposals = createOfflineProposals({ bundle: normalizedBundle, mode, config: descriptor, instruction, targetCardId, assetId, request, feedback });

  return {
    schemaVersion: AI_EDIT_SCHEMA_VERSION,
    baseFingerprint: request.context.bundle.fingerprint,
    mode,
    config: descriptor,
    request,
    ...(feedback ? { feedback } : {}),
    proposals
  };
}

export async function createAiEditSuggestionsFromEndpoint({
  bundle,
  mode = "generate_cards",
  config = {},
  credentials = {},
  instruction = "",
  targetCardId = null,
  assetId = null,
  diagnostics = null,
  fetchImpl = globalThis.fetch
}) {
  if (!AI_EDIT_MODES.has(mode)) {
    throw new PipelineError(`Unknown AI edit mode '${mode}'`, "unknown_ai_mode");
  }
  if (typeof fetchImpl !== "function") {
    throw new PipelineError("AI endpoint execution requires fetch", "endpoint_fetch_unavailable");
  }

  const normalizedBundle = createContentBundle(bundle);
  const descriptor = redactAiEndpointConfig(config ?? {});
  const endpoint = normalizeEndpointValue(descriptor.endpoint);
  const protocol = normalizeAiEndpointProtocol(descriptor.provider);
  const routeMode = normalizeAiEndpointRouteMode(descriptor.routeMode);
  const model = normalizeEndpointValue(descriptor.modelId);
  if (!endpoint || !model) {
    throw new PipelineError("AI endpoint execution requires endpoint and modelId", "endpoint_config_required");
  }

  const targetCardIds = isNonEmptyString(targetCardId) ? [targetCardId] : [];
  const style = isNonEmptyString(descriptor.style) ? descriptor.style : "editorial card art";
  const request = mode === "generate_asset" || mode === "analyze_asset"
    ? buildMediaEditRequest({ bundle: normalizedBundle, mode, instruction, targetCardId, assetId, style, diagnostics })
    : buildCardEditRequest({ bundle: normalizedBundle, instruction, targetCardIds, diagnostics, constraints: descriptor.constraints ?? {} });
  const feedback = diagnostics ? createDiagnosticFeedback(diagnostics) : null;
  const endpointResult = await callAiEditEndpoint({
    endpoint,
    protocol,
    routeMode,
    model,
    request,
    config: descriptor,
    apiKey: normalizeEndpointValue(credentials?.apiKey),
    fetchImpl
  });
  const proposals = normalizeProviderProposals({
    bundle: normalizedBundle,
    mode,
    protocol,
    provider: descriptor.provider ?? protocol,
    response: endpointResult.proposals
  });

  return {
    schemaVersion: AI_EDIT_SCHEMA_VERSION,
    baseFingerprint: request.context.bundle.fingerprint,
    mode,
    config: descriptor,
    request,
    provider: {
      protocol,
      routeMode,
      endpoint: redactEndpointUrl(endpointResult.url),
      model
    },
    ...(feedback ? { feedback } : {}),
    proposals
  };
}

export async function validateAiEditEndpoint({
  bundle,
  config = {},
  credentials = {},
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== "function") {
    throw new PipelineError("AI endpoint validation requires fetch", "endpoint_fetch_unavailable");
  }

  const normalizedBundle = createContentBundle(bundle);
  const descriptor = redactAiEndpointConfig(config ?? {});
  const endpoint = normalizeEndpointValue(descriptor.endpoint);
  const protocol = normalizeAiEndpointProtocol(descriptor.provider);
  const routeMode = normalizeAiEndpointRouteMode(descriptor.routeMode);
  const model = normalizeEndpointValue(descriptor.modelId);
  if (!endpoint || !model) {
    throw new PipelineError("AI endpoint validation requires endpoint and modelId", "endpoint_config_required");
  }

  const request = buildAiEndpointValidationRequest({ bundle: normalizedBundle });
  const endpointResult = await callAiEditEndpoint({
    endpoint,
    protocol,
    routeMode,
    model,
    request,
    config: descriptor,
    apiKey: normalizeEndpointValue(credentials?.apiKey),
    fetchImpl
  });
  const proposals = endpointResult.proposals.length > 0
    ? normalizeProviderProposals({
      bundle: normalizedBundle,
      mode: "generate_cards",
      protocol,
      provider: descriptor.provider ?? protocol,
      response: endpointResult.proposals
    })
    : [];

  return {
    schemaVersion: AI_EDIT_SCHEMA_VERSION,
    ok: true,
    baseFingerprint: request.context.bundle.fingerprint,
    config: descriptor,
    request: {
      requestId: request.requestId,
      purpose: request.purpose,
      responseFormat: request.responseFormat,
      context: {
        fingerprint: request.context.bundle.fingerprint,
        cardCount: request.context.bundle.cardCount,
        assetCount: request.context.bundle.assetCount
      }
    },
    provider: {
      protocol,
      routeMode,
      endpoint: redactEndpointUrl(endpointResult.url),
      model
    },
    proposalCount: proposals.length
  };
}

export async function listAiEndpointModels({
  config = {},
  credentials = {},
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== "function") {
    throw new PipelineError("AI endpoint model listing requires fetch", "endpoint_fetch_unavailable");
  }

  const descriptor = redactAiEndpointConfig(config ?? {});
  const endpoint = normalizeEndpointValue(descriptor.endpoint);
  const protocol = normalizeAiEndpointProtocol(descriptor.provider);
  const routeMode = normalizeAiEndpointRouteMode(descriptor.routeMode);
  if (!endpoint) {
    throw new PipelineError("AI endpoint model listing requires endpoint", "endpoint_config_required");
  }

  const url = resolveAiModelsEndpointUrl(endpoint, routeMode);
  const headers = {
    accept: "application/json"
  };
  const apiKey = normalizeEndpointValue(credentials?.apiKey);
  if (apiKey) {
    if (protocol === "anthropic_messages") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.authorization = `Bearer ${apiKey}`;
    }
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers
    });
  } catch (error) {
    throw new PipelineError(`AI endpoint model listing failed: ${error.message}`, "endpoint_network_error");
  }

  const text = typeof response?.text === "function" ? await response.text() : "";
  if (!response?.ok) {
    throw new PipelineError(`AI endpoint model listing failed with status ${response?.status ?? "unknown"}`, "endpoint_http_error");
  }

  return {
    schemaVersion: AI_EDIT_SCHEMA_VERSION,
    ok: true,
    config: descriptor,
    provider: {
      protocol,
      routeMode,
      endpoint: redactEndpointUrl(url)
    },
    models: parseAiEndpointModelsResponse(text)
  };
}

export function applyAiEditPatches({ bundle, patches }) {
  if (!Array.isArray(patches)) {
    throw new PipelineError("AI edit patches must be an array");
  }

  const working = cloneJsonValue(createContentBundle(bundle), "AI edit bundle");

  for (const patch of patches) {
    applyAiEditPatch(working, patch);
  }

  const nextBundle = createContentBundle(working);
  return {
    bundle: nextBundle,
    validation: validateContentBundle(nextBundle)
  };
}

export function buildCardGenerationPrompt({ theme, count, constraints = {}, diagnostics = null }) {
  if (!theme) {
    throw new PipelineError("theme is required");
  }

  if (!Number.isInteger(count) || count <= 0) {
    throw new PipelineError("count must be a positive integer");
  }

  const lines = [
    `Generate ${count} minimalist Reigns-style cards for: ${theme}.`,
    "Return only JSON with a top-level cards array.",
    "Each card needs id, text, and two concise choices with gauge/tag effects.",
    "Card requirements may combine tags, exact variables, and default gauge thresholds for story branches.",
    "Use only low-level tags and variables for custom state; do not create built-in upper-level progression systems.",
    `Constraints: ${JSON.stringify(constraints)}`
  ];

  if (diagnostics) {
    lines.push(`Reviewer feedback: ${JSON.stringify(createDiagnosticFeedback(diagnostics))}`);
  }

  return lines.join("\n");
}

export class PipelineError extends Error {
  constructor(message, code = "pipeline_error") {
    super(message);
    this.name = "PipelineError";
    this.code = code;
  }
}

function parseJsonSource(source, context) {
  if (typeof source !== "string") {
    return source;
  }

  try {
    return JSON.parse(extractJsonPayload(source));
  } catch (error) {
    throw new PipelineError(`${context} contains invalid JSON: ${error.message}`);
  }
}

function extractJsonPayload(source) {
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : source.trim();
}

function normalizeMetadata(metadata) {
  if (!isPlainRecord(metadata)) {
    throw new PipelineError("Content bundle metadata must be an object");
  }

  const normalized = { ...metadata };
  const presentation = metadata.presentation;
  if (isPlainRecord(presentation) && isPlainRecord(presentation.gauges)) {
    normalized.presentation = {
      ...presentation,
      gauges: normalizeFactionValueMap(presentation.gauges, "metadata.presentation.gauges")
    };
  }
  return normalized;
}

function normalizeAssets(assets) {
  const errors = [];
  validateAssets(assets, errors);

  if (errors.length > 0) {
    throw new PipelineError(`Asset validation failed:\n- ${errors.join("\n- ")}`);
  }

  return assets.map((asset) => ({ ...asset }));
}

function validateAssets(assets, errors) {
  if (!Array.isArray(assets)) {
    errors.push("Content bundle assets must be an array");
    return;
  }

  const seenAssetIds = new Set();
  for (const [index, asset] of assets.entries()) {
    const context = `Asset at index ${index}`;

    if (!isPlainRecord(asset)) {
      errors.push(`${context} must be an object`);
      continue;
    }

    if (!isNonEmptyString(asset.id)) {
      errors.push(`${context} requires a non-empty id`);
    } else if (seenAssetIds.has(asset.id)) {
      errors.push(`Duplicate asset id '${asset.id}'`);
    } else {
      seenAssetIds.add(asset.id);
    }

    if (asset.cardId !== undefined && !isNonEmptyString(asset.cardId)) {
      errors.push(`${context}.cardId must be a non-empty string`);
    }

    if (asset.uri !== undefined && !isNonEmptyString(asset.uri)) {
      errors.push(`${context}.uri must be a non-empty string`);
    }
  }
}

function normalizeCard(card) {
  if (!card?.id) {
    throw new PipelineError("Card requires an id");
  }

  if (!Array.isArray(card.choices) || card.choices.length === 0) {
    throw new PipelineError(`Card '${card.id}' requires at least one choice`);
  }

  return {
    ...card,
    weight: card.weight ?? 1,
    requirements: normalizeRequirementKeys(card.requirements === undefined ? {} : card.requirements),
    choices: card.choices.map((choice) => {
      if (!choice?.id) {
        throw new PipelineError(`Card '${card.id}' has a choice without an id`);
      }

      return {
        ...choice,
        effects: normalizeEffectKeys(choice.effects === undefined ? {} : choice.effects)
      };
    })
  };
}

function normalizeRequirementKeys(requirements) {
  const normalized = { ...requirements };
  if (requirements.factions !== undefined) {
    normalized.factions = normalizeFactionValueMap(requirements.factions, "requirements.factions");
  }
  return normalized;
}

function normalizeEffectKeys(effects) {
  const normalized = { ...effects };
  if (effects.factions !== undefined) {
    normalized.factions = normalizeFactionValueMap(effects.factions, "effects.factions");
  }
  return normalized;
}

function normalizeCards(cards) {
  assertValidCardSet(cards);
  return cards.map(normalizeCard);
}

function validateCard(card, cardIndex, seenCardIds, errors, warnings) {
  const context = `Card at index ${cardIndex}`;

  if (!isPlainRecord(card)) {
    errors.push(`${context} must be an object`);
    return;
  }

  if (!isNonEmptyString(card.id)) {
    errors.push(`${context} requires a non-empty id`);
  } else if (seenCardIds.has(card.id)) {
    errors.push(`Duplicate card id '${card.id}'`);
  } else {
    seenCardIds.add(card.id);
  }

  if (card.text === undefined || card.text === "") {
    warnings.push(`${context} has no display text`);
  }

  if (card.weight !== undefined && (!Number.isFinite(card.weight) || card.weight <= 0)) {
    errors.push(`${context} weight must be a positive finite number`);
  }

  validateRequirements(card.requirements === undefined ? {} : card.requirements, `${context} requirements`, errors);

  if (!Array.isArray(card.choices) || card.choices.length === 0) {
    errors.push(`${context} requires at least one choice`);
    return;
  }

  const seenChoiceIds = new Set();
  for (const [choiceIndex, choice] of card.choices.entries()) {
    validateChoice(choice, `${context} choice at index ${choiceIndex}`, seenChoiceIds, errors, warnings);
  }
}

function validateChoice(choice, context, seenChoiceIds, errors, warnings) {
  if (!isPlainRecord(choice)) {
    errors.push(`${context} must be an object`);
    return;
  }

  if (!isNonEmptyString(choice.id)) {
    errors.push(`${context} requires a non-empty id`);
  } else if (seenChoiceIds.has(choice.id)) {
    errors.push(`${context} duplicate choice id '${choice.id}'`);
  } else {
    seenChoiceIds.add(choice.id);
  }

  if (choice.label === undefined || choice.label === "") {
    warnings.push(`${context} has no display label`);
  }

  validateEffects(choice.effects === undefined ? {} : choice.effects, `${context} effects`, errors);
}

function validateRequirements(requirements, context, errors) {
  if (!isPlainRecord(requirements)) {
    errors.push(`${context} must be an object`);
    return;
  }

  for (const key of Object.keys(requirements)) {
    if (!REQUIREMENT_KEYS.has(key)) {
      errors.push(`${context} has unknown key '${key}'`);
    }
  }

  validateStringArray(requirements.allTags ?? [], `${context}.allTags`, errors);
  validateStringArray(requirements.anyTags ?? [], `${context}.anyTags`, errors);
  validateStringArray(requirements.noneTags ?? [], `${context}.noneTags`, errors);

  if (requirements.variables !== undefined && !isPlainRecord(requirements.variables)) {
    errors.push(`${context}.variables must be an object`);
  }

  validateFactionRequirements(requirements.factions, `${context}.factions`, errors);
}

function validateEffects(effects, context, errors) {
  if (!isPlainRecord(effects)) {
    errors.push(`${context} must be an object`);
    return;
  }

  for (const key of Object.keys(effects)) {
    if (!EFFECT_KEYS.has(key)) {
      errors.push(`${context} has unknown key '${key}'`);
    }
  }

  if (effects.tags !== undefined && !isPlainRecord(effects.tags)) {
    errors.push(`${context}.tags must be an object`);
  }

  if (effects.variables !== undefined && !isPlainRecord(effects.variables)) {
    errors.push(`${context}.variables must be an object`);
  }

  if (effects.factions !== undefined) {
    if (!isPlainRecord(effects.factions)) {
      errors.push(`${context}.factions must be an object`);
    } else {
      for (const [faction, delta] of Object.entries(effects.factions)) {
        const key = normalizeFactionKey(faction);
        if (!key) {
          errors.push(`${context}.factions has unknown faction '${faction}'`);
        }

        if (!Number.isFinite(delta)) {
          errors.push(`${context}.factions.${key ?? faction} must be finite`);
        }
      }
    }
  }

  if (effects.activateHooks !== undefined) {
    if (!Array.isArray(effects.activateHooks)) {
      errors.push(`${context}.activateHooks must be an array`);
    } else {
      for (const [index, hookEntry] of effects.activateHooks.entries()) {
        validateHookEntry(hookEntry, `${context}.activateHooks[${index}]`, errors);
      }
    }
  }

  if (effects.dismissHooks !== undefined) {
    validateStringArray(effects.dismissHooks, `${context}.dismissHooks`, errors);
  }
}

function validateFactionRequirements(requirements, context, errors) {
  if (requirements === undefined) {
    return;
  }

  if (!isPlainRecord(requirements)) {
    errors.push(`${context} must be an object`);
    return;
  }

  for (const [faction, rule] of Object.entries(requirements)) {
    const key = normalizeFactionKey(faction);
    if (!key) {
      errors.push(`${context} has unknown faction '${faction}'`);
      continue;
    }
    validateFactionRequirementRule(rule, `${context}.${key}`, errors);
  }
}

function validateFactionRequirementRule(rule, context, errors) {
  if (Number.isFinite(rule)) {
    validateFactionThreshold(rule, context, errors);
    return;
  }

  if (!isPlainRecord(rule)) {
    errors.push(`${context} must be a finite number or an object`);
    return;
  }

  const allowedKeys = new Set(["min", "max", "equals"]);
  const keys = Object.keys(rule);
  if (keys.length === 0) {
    errors.push(`${context} must include min, max, or equals`);
    return;
  }

  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      errors.push(`${context} has unknown key '${key}'`);
      continue;
    }
    validateFactionThreshold(rule[key], `${context}.${key}`, errors);
  }

  if (Number.isFinite(rule.min) && Number.isFinite(rule.max) && rule.min > rule.max) {
    errors.push(`${context}.min must be less than or equal to max`);
  }
}

function validateFactionThreshold(value, context, errors) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    errors.push(`${context} must be a finite number between 0 and 100`);
  }
}

function validateHookEntry(hookEntry, context, errors) {
  if (!isPlainRecord(hookEntry)) {
    errors.push(`${context} must be an object`);
    return;
  }

  if (!isNonEmptyString(hookEntry.id)) {
    errors.push(`${context} requires a non-empty id`);
  }

  validateStringArray(hookEntry.tags ?? [], `${context}.tags`, errors);
}

function validateStringArray(value, context, errors) {
  if (!Array.isArray(value) || value.some((entry) => !isNonEmptyString(entry))) {
    errors.push(`${context} must be an array of non-empty strings`);
  }
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function parseCsvRows(source) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quoted && char === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      quoted = !quoted;
      continue;
    }

    if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function formatCsvRow(row) {
  return row.map(formatCsvCell).join(",");
}

function formatCsvCell(value) {
  const text = String(value ?? "");

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }

  return text;
}

function cell(row, index) {
  return row[index] ?? "";
}

function parseJsonCell(value, column) {
  if (value === "") {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new PipelineError(`Column '${column}' contains invalid JSON: ${error.message}`);
  }
}

function parseWeight(value) {
  if (value === "") {
    return 1;
  }

  const weight = Number(value);
  if (!Number.isFinite(weight)) {
    throw new PipelineError("Card weight must be a finite number");
  }

  return weight;
}

function extractTextPayload(response) {
  if (typeof response === "string") {
    return extractJsonPayload(response);
  }

  if (typeof response?.text === "string") {
    return extractJsonPayload(response.text);
  }

  throw new PipelineError("generateText must return a string or an object with a text field");
}

async function callAiEditEndpoint({ endpoint, protocol, routeMode = "auto", model, request, config, apiKey, fetchImpl }) {
  const url = resolveAiEndpointUrl(endpoint, protocol, routeMode);
  const wantsStructuredJson = shouldUseStructuredJson(config);
  const headers = {
    "content-type": "application/json",
    accept: "application/json"
  };
  if (apiKey) {
    if (protocol === "anthropic_messages") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.authorization = `Bearer ${apiKey}`;
    }
  }

  const firstAttempt = await postAiEditEndpoint({
    fetchImpl,
    url,
    headers,
    body: buildAiEndpointBody({ protocol, model, request, config, includeStructuredJson: wantsStructuredJson })
  });
  const result = firstAttempt.ok || !wantsStructuredJson || !isStructuredJsonUnsupportedError(firstAttempt.text)
    ? firstAttempt
    : await postAiEditEndpoint({
      fetchImpl,
      url,
      headers,
      body: buildAiEndpointBody({ protocol, model, request, config, includeStructuredJson: false })
    });

  if (!result.ok) {
    const status = result.status ?? "unknown";
    throw new PipelineError(`AI endpoint request failed with status ${status}`, "endpoint_http_error");
  }

  return {
    url,
    proposals: parseAiEndpointProposalResponse(result.text, protocol)
  };
}

async function postAiEditEndpoint({ fetchImpl, url, headers, body }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new PipelineError(`AI endpoint request failed: ${error.message}`, "endpoint_network_error");
  }

  const text = typeof response?.text === "function" ? await response.text() : "";
  return {
    ok: Boolean(response?.ok),
    status: response?.status,
    text
  };
}

function resolveAiEndpointUrl(endpoint, protocol, routeMode = "auto") {
  const route = AI_ENDPOINT_ROUTES[protocol];
  if (!route) {
    throw new PipelineError(`Unsupported AI endpoint protocol '${protocol}'`, "endpoint_protocol_unsupported");
  }
  const trimmed = String(endpoint ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new PipelineError("AI endpoint is required", "endpoint_config_required");
  }
  const normalizedRouteMode = normalizeAiEndpointRouteMode(routeMode);
  if (normalizedRouteMode === "full_url") {
    return trimmed;
  }
  const normalizedRoute = route.replace(/^\/+/, "");
  if (
    normalizedRouteMode === "auto" &&
    Object.values(AI_ENDPOINT_ROUTES).some((candidate) => {
      const normalizedCandidate = candidate.replace(/^\/+/, "").toLowerCase();
      return trimmed.toLowerCase().endsWith(`/${normalizedCandidate}`);
    })
  ) {
    return trimmed;
  }
  return `${trimmed}/${normalizedRoute}`;
}

function resolveAiModelsEndpointUrl(endpoint, routeMode = "auto") {
  const trimmed = String(endpoint ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new PipelineError("AI endpoint is required", "endpoint_config_required");
  }
  if (trimmed.toLowerCase().endsWith("/models")) {
    return trimmed;
  }

  const normalizedRouteMode = normalizeAiEndpointRouteMode(routeMode);
  let root = trimmed;
  if (normalizedRouteMode !== "api_root") {
    for (const route of Object.values(AI_ENDPOINT_ROUTES)) {
      const suffix = `/${route.replace(/^\/+/, "")}`.toLowerCase();
      if (root.toLowerCase().endsWith(suffix)) {
        root = root.slice(0, -suffix.length);
        break;
      }
    }
  }
  return `${root.replace(/\/+$/, "")}/models`;
}

function buildAiEndpointBody({ protocol, model, request, config, includeStructuredJson = shouldUseStructuredJson(config) }) {
  const prompt = buildAiEndpointPrompt(request);

  if (protocol === "openai_responses") {
    return {
      model,
      input: prompt,
      ...(includeStructuredJson ? { text: { format: { type: "json_object" } } } : {}),
      temperature: 0
    };
  }

  if (protocol === "openai_chat") {
    return {
      model,
      messages: [
        {
          role: "system",
          content: "You create ReignsAgent AI Assist edit proposals. Return only a JSON object with a proposals array."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      ...(includeStructuredJson ? { response_format: { type: "json_object" } } : {}),
      temperature: 0
    };
  }

  if (protocol === "openai_completions") {
    return {
      model,
      prompt,
      temperature: 0
    };
  }

  if (protocol === "anthropic_messages") {
    return {
      model,
      max_tokens: 4096,
      system: "You create ReignsAgent AI Assist edit proposals. Return only a JSON object with a proposals array.",
      messages: [{ role: "user", content: prompt }],
      temperature: 0
    };
  }

  throw new PipelineError(`Unsupported AI endpoint protocol '${protocol}'`, "endpoint_protocol_unsupported");
}

function shouldUseStructuredJson(config = {}) {
  if (config.jsonMode === "off") return false;
  if (config.jsonMode === "force") return true;
  return Array.isArray(config.capabilities)
    ? config.capabilities.includes("structuredJson")
    : true;
}

function isStructuredJsonUnsupportedError(text) {
  const lower = String(text ?? "").toLowerCase();
  return (
    lower.includes("response_format") ||
    lower.includes("json_object") ||
    lower.includes("json mode") ||
    lower.includes("structured json")
  ) && (
    lower.includes("unsupported") ||
    lower.includes("not supported") ||
    lower.includes("unknown parameter") ||
    lower.includes("unrecognized") ||
    lower.includes("invalid")
  );
}

function buildAiEndpointPrompt(request) {
  if (request?.purpose === "ai_endpoint_validation") {
    return [
      "Return only valid JSON exactly in this top-level shape:",
      "{\"proposals\":[]}",
      "This is a connectivity and protocol validation request. Do not propose edits, patches, markdown, commentary, or external file references.",
      "Request:",
      JSON.stringify(request, null, 2)
    ].join("\n");
  }

  return [
    "Return only valid JSON in this exact top-level shape:",
    "{\"proposals\":[{\"id\":\"proposal-id\",\"title\":\"Title\",\"summary\":\"Summary\",\"source\":{},\"target\":{},\"patches\":[]}]}",
    "Use only patch operations declared in the supplied ReignsAgent context.",
    "Do not include markdown, commentary, external file references, or binary data.",
    "Request:",
    JSON.stringify(request, null, 2)
  ].join("\n");
}

function parseAiEndpointModelsResponse(text) {
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new PipelineError(`AI endpoint models response was not valid JSON: ${error.message}`, "endpoint_parse_error");
  }

  const rawModels = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : null;
  if (!rawModels) {
    throw new PipelineError("AI endpoint models response must include data or models array", "endpoint_parse_error");
  }

  const seen = new Set();
  return rawModels.flatMap((model) => {
    const id = typeof model === "string"
      ? model.trim()
      : normalizeEndpointValue(model?.id ?? model?.name ?? model?.model);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const label = typeof model === "object" && model
      ? normalizeEndpointValue(model.label ?? model.display_name ?? model.name) ?? id
      : id;
    return [{ id, label }];
  });
}

function parseAiEndpointProposalResponse(text, protocol) {
  const raw = String(text ?? "").trim();
  if (!raw) {
    throw new PipelineError("AI endpoint returned an empty response", "endpoint_empty_response");
  }
  const parsed = parsePossiblyFencedJson(raw, "AI endpoint response");
  const proposalDocument = findProposalDocument(parsed) ?? findProposalDocumentFromText(extractProviderText(parsed, protocol));
  if (!proposalDocument) {
    throw new PipelineError("AI endpoint response must contain a proposals array", "endpoint_invalid_response");
  }
  return proposalDocument.proposals;
}

function findProposalDocument(value) {
  if (isPlainRecord(value) && Array.isArray(value.proposals)) {
    return value;
  }
  return null;
}

function findProposalDocumentFromText(text) {
  if (!text) {
    return null;
  }
  return findProposalDocument(parsePossiblyFencedJson(text, "AI endpoint text payload"));
}

function extractProviderText(value, protocol) {
  if (typeof value === "string") {
    return value;
  }
  if (!isPlainRecord(value)) {
    return "";
  }
  if (typeof value.output_text === "string") {
    return value.output_text;
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (Array.isArray(value.output)) {
    const parts = [];
    for (const output of value.output) {
      if (!isPlainRecord(output) || !Array.isArray(output.content)) continue;
      for (const content of output.content) {
        if (typeof content?.text === "string") parts.push(content.text);
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }
  const choice = Array.isArray(value.choices) ? value.choices[0] : null;
  if (protocol === "openai_chat" && typeof choice?.message?.content === "string") {
    return choice.message.content;
  }
  if (protocol === "openai_completions" && typeof choice?.text === "string") {
    return choice.text;
  }
  if (protocol === "anthropic_messages" && Array.isArray(value.content)) {
    const parts = value.content
      .map((content) => typeof content?.text === "string" ? content.text : "")
      .filter(Boolean);
    if (parts.length > 0) return parts.join("\n");
  }
  if (typeof choice?.message?.content === "string") {
    return choice.message.content;
  }
  if (typeof choice?.text === "string") {
    return choice.text;
  }
  return "";
}

function parsePossiblyFencedJson(source, context) {
  const raw = String(source ?? "").trim();
  try {
    return JSON.parse(raw);
  } catch (error) {
    const text = extractJsonPayload(raw);
    try {
      return JSON.parse(text);
    } catch {
      // Try the escaped-quote recovery below before reporting the original parse.
    }
    if (text.includes("\\\"")) {
      try {
        return JSON.parse(text.replace(/\\"/g, "\""));
      } catch {
        // Fall through to the original parse error; it points at the raw provider text.
      }
    }
    throw new PipelineError(`${context} contains invalid JSON: ${error.message}`, "endpoint_parse_error");
  }
}

function normalizeProviderProposals({ bundle, mode, protocol, provider, response }) {
  if (!Array.isArray(response)) {
    throw new PipelineError("AI endpoint proposals must be an array", "endpoint_invalid_response");
  }

  return response.map((proposal) => {
    if (!isPlainRecord(proposal)) {
      throw new PipelineError("AI endpoint proposal must be an object", "endpoint_invalid_response");
    }
    if (!isNonEmptyString(proposal.id)) {
      throw new PipelineError("AI endpoint proposal requires a non-empty id", "endpoint_invalid_response");
    }
    if (!isNonEmptyString(proposal.title)) {
      throw new PipelineError(`AI endpoint proposal '${proposal.id}' requires a title`, "endpoint_invalid_response");
    }
    if (!Array.isArray(proposal.patches)) {
      throw new PipelineError(`AI endpoint proposal '${proposal.id}' requires patches`, "endpoint_invalid_response");
    }

    const normalized = {
      id: proposal.id,
      title: proposal.title,
      summary: typeof proposal.summary === "string" ? proposal.summary : "Provider proposal.",
      source: isPlainRecord(proposal.source)
        ? cloneJsonValue(proposal.source, `AI endpoint proposal '${proposal.id}' source`)
        : { mode, provider, protocol },
      target: isPlainRecord(proposal.target)
        ? cloneJsonValue(proposal.target, `AI endpoint proposal '${proposal.id}' target`)
        : {},
      patches: cloneJsonValue(proposal.patches, `AI endpoint proposal '${proposal.id}' patches`),
      ...(proposal.preview !== undefined ? { preview: cloneJsonValue(proposal.preview, `AI endpoint proposal '${proposal.id}' preview`) } : {})
    };

    applyAiEditPatches({ bundle, patches: normalized.patches });
    return normalized;
  });
}

function redactEndpointUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/key|token|secret|credential/i.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }
    return parsed.toString();
  } catch {
    return String(url ?? "").replace(/([?&][^=]*(?:key|token|secret|credential)[^=]*=)[^&]+/gi, "$1[redacted]");
  }
}

function redactAiEndpointConfig(config) {
  const descriptor = cloneJsonValue(config ?? {}, "AI endpoint config");
  if (isPlainRecord(descriptor)) {
    delete descriptor.apiKey;
    delete descriptor.credentials;
    delete descriptor.secret;
  }
  return descriptor;
}

function normalizeEndpointValue(value) {
  if (typeof value !== "string") return null;
  let normalized = value.trim();
  if (normalized.endsWith(";")) {
    normalized = normalized.slice(0, -1).trim();
  }
  normalized = normalized.replace(/^['"]|['"]$/g, "").trim();
  return normalized ? normalized : null;
}

function normalizeAiEndpointProtocol(provider) {
  const value = normalizeEndpointValue(provider) ?? "openai_chat";
  if (value === "stub" || value === "local-stub") {
    return "openai_chat";
  }
  const canonical = AI_ENDPOINT_PROTOCOL_ALIASES[value] ?? value;
  if (!AI_ENDPOINT_ROUTES[canonical]) {
    throw new PipelineError(`Unsupported AI endpoint protocol '${canonical}'`, "endpoint_protocol_unsupported");
  }
  return canonical;
}

function normalizeAiEndpointRouteMode(value) {
  const normalized = normalizeEndpointValue(value) ?? "auto";
  if (!AI_ENDPOINT_ROUTE_MODES.has(normalized)) {
    throw new PipelineError(`Unsupported AI endpoint route mode '${normalized}'`, "endpoint_route_mode_unsupported");
  }
  return normalized;
}

function addAction(actions, seenActions, action) {
  const key = `${action.type}:${JSON.stringify(action.target)}`;

  if (seenActions.has(key)) {
    return;
  }

  seenActions.add(key);
  actions.push(action);
}

function createOfflineProposals({ bundle, mode, config, instruction, targetCardId, assetId, request, feedback }) {
  if (mode === "generate_cards") {
    return createDraftCardProposals(bundle, config, instruction);
  }
  if (mode === "repair_diagnostics") {
    return createRepairProposals(bundle, targetCardId, feedback);
  }
  if (mode === "generate_asset") {
    return createAssetGenerationProposal(bundle, config, instruction, targetCardId, request);
  }
  if (mode === "analyze_asset") {
    return createAssetAnalysisProposal(bundle, instruction, targetCardId, assetId, request);
  }
  return [];
}

function createDraftCardProposals(bundle, config, instruction) {
  const count = Math.max(1, Math.min(12, Number.isInteger(config.cardCount) ? config.cardCount : 2));
  const theme = String(config.theme ?? bundle.metadata.title ?? "untitled court").trim() || "untitled court";
  const prompt = String(instruction ?? "").trim();
  const proposals = [];

  for (let index = 0; index < count; index += 1) {
    const id = uniqueCardId(bundle.cards, slugify(`ai-${theme}-${index + 1}`));
    const card = {
      id,
      text: `A new petition tests ${theme}${prompt ? `: ${prompt}` : "."}`,
      weight: 1,
      requirements: {},
      choices: [
        {
          id: "left",
          label: "Hear them",
          effects: { factions: { gauge1: 2, gauge3: -1 } }
        },
        {
          id: "right",
          label: "Delay",
          effects: { factions: { gauge1: -1, gauge3: 1 } }
        }
      ]
    };
    proposals.push({
      id: `proposal-${id}`,
      title: `Draft card ${index + 1}`,
      summary: `Adds a deterministic local draft for ${theme}.`,
      source: { mode: "generate_cards", provider: config.provider ?? "local-stub" },
      target: { cardIds: [id] },
      patches: [{ op: "addCard", card }],
      preview: { card }
    });
  }

  return proposals;
}

function createRepairProposals(bundle, targetCardId, feedback) {
  const proposals = [];
  const actions = feedback?.actions ?? [];
  const selectedCard = isNonEmptyString(targetCardId) ? bundle.cards.find((card) => card.id === targetCardId) : null;
  const defaultProducer = selectedCard ?? bundle.cards[0] ?? null;

  for (const [index, action] of actions.entries()) {
    if (action.type === "raise_card_exposure") {
      for (const cardId of normalizeStringArray(action.target)) {
        const card = bundle.cards.find((candidate) => candidate.id === cardId);
        if (!card) continue;
        proposals.push(repairProposal(index, action, {
          title: `Raise ${cardId} exposure`,
          target: { cardIds: [cardId] },
          patches: [{ op: "updateCard", cardId, changes: { weight: Math.max(1.5, roundNumber((card.weight ?? 1) + 0.75)) } }],
          preview: { before: { weight: card.weight ?? 1 }, after: { weight: Math.max(1.5, roundNumber((card.weight ?? 1) + 0.75)) } }
        }));
      }
    }

    if (action.type === "repair_reachability" || action.type === "relax_requirements") {
      for (const cardId of normalizeStringArray(action.target)) {
        const card = bundle.cards.find((candidate) => candidate.id === cardId);
        if (!card || Object.keys(card.requirements ?? {}).length === 0) continue;
        proposals.push(repairProposal(index, action, {
          title: `Relax ${cardId} gate`,
          target: { cardIds: [cardId] },
          patches: [{ op: "updateCard", cardId, changes: { requirements: {} } }],
          preview: { before: { requirements: card.requirements }, after: { requirements: {} } }
        }));
      }
    }

    if (action.type === "add_tag_producers" && defaultProducer) {
      const tags = normalizeStringArray(action.target);
      if (tags.length > 0) {
        const choice = defaultProducer.choices.find((candidate) => candidate.id === "left") ?? defaultProducer.choices[0];
        const nextEffects = {
          ...(choice.effects ?? {}),
          tags: {
            ...(choice.effects?.tags ?? {}),
            ...Object.fromEntries(tags.map((tag) => [tag, true]))
          }
        };
        proposals.push(repairProposal(index, action, {
          title: "Add missing tag producer",
          target: { cardIds: [defaultProducer.id], tags },
          patches: [{ op: "setChoiceEffects", cardId: defaultProducer.id, choiceId: choice.id, effects: nextEffects }],
          preview: { choiceId: choice.id, tags }
        }));
      }
    }

    if (action.type === "add_fallback_cards") {
      const card = {
        id: uniqueCardId(bundle.cards, "ai-fallback"),
        text: "A quiet messenger brings a plain matter back before the court.",
        weight: 1,
        requirements: {},
        choices: [
          { id: "left", label: "Answer", effects: { factions: { gauge1: 1 } } },
          { id: "right", label: "Table it", effects: { factions: { gauge3: 1 } } }
        ]
      };
      proposals.push(repairProposal(index, action, {
        title: "Add fallback card",
        target: { cardIds: [card.id] },
        patches: [{ op: "addCard", card }],
        preview: { card }
      }));
    }

    if (action.type === "rebalance_faction_pressure") {
      const faction = normalizeFactionKey(String(action.target)) ?? "gauge1";
      const patches = [];
      const affected = [];
      for (const card of bundle.cards) {
        for (const choice of card.choices) {
          const current = choice.effects?.factions?.[faction];
          if (Number.isFinite(current) && Math.abs(current) >= 2) {
            patches.push({
              op: "setChoiceEffects",
              cardId: card.id,
              choiceId: choice.id,
              effects: {
                ...(choice.effects ?? {}),
                factions: {
                  ...(choice.effects?.factions ?? {}),
                  [faction]: Math.trunc(current / 2)
                }
              }
            });
            affected.push(card.id);
          }
          if (patches.length >= 4) break;
        }
        if (patches.length >= 4) break;
      }
      if (patches.length > 0) {
        proposals.push(repairProposal(index, action, {
          title: `Reduce ${faction} pressure`,
          target: { cardIds: [...new Set(affected)], faction },
          patches,
          preview: { patchCount: patches.length, faction }
        }));
      }
    }
  }

  return proposals;
}

function repairProposal(index, action, entry) {
  return {
    id: `repair-${index + 1}-${slugify(entry.title)}`,
    title: entry.title,
    summary: action.reason ?? "Reviewer diagnostic repair proposal.",
    source: { mode: "repair_diagnostics", warning: action.sourceWarning, action: action.type, severity: action.severity },
    target: entry.target,
    patches: entry.patches,
    preview: entry.preview
  };
}

function createAssetGenerationProposal(bundle, config, instruction, targetCardId, request) {
  const card = bundle.cards.find((candidate) => candidate.id === targetCardId) ?? null;
  const style = request.metadata.style || config.style || "editorial card art";
  const patches = card
    ? [{
        op: "upsertAsset",
        asset: {
          id: uniqueAssetId(bundle.assets, `${card.id}-ai-asset`),
          cardId: card.id,
          uri: `pending://${card.id}`,
          title: `AI asset request for ${card.id}`,
          source: "local-ai-assist",
          metadata: {
            mode: "generate_asset",
            style,
            instruction: String(instruction ?? "").trim()
          }
        }
      }]
    : [];

  return [{
    id: "media-generate-preview",
    title: "Visual request preview",
    summary: card ? `Prepares a placeholder asset request for ${card.id}.` : "Previews a future visual generation request.",
    source: { mode: "generate_asset", provider: config.provider ?? "local-stub" },
    target: { cardIds: card ? [card.id] : [], assetIds: patches[0] ? [patches[0].asset.id] : [] },
    patches,
    preview: { requestId: request.requestId, prompt: request.prompt, style }
  }];
}

function createAssetAnalysisProposal(bundle, instruction, targetCardId, assetId, request) {
  const card = bundle.cards.find((candidate) => candidate.id === targetCardId) ?? null;
  return [{
    id: "media-analysis-preview",
    title: "Visual analysis preview",
    summary: "Previews a future image analysis request without changing content.",
    source: { mode: "analyze_asset", provider: "local-stub" },
    target: { cardIds: card ? [card.id] : [], assetIds: assetId ? [assetId] : [] },
    patches: [],
    preview: {
      requestId: request.requestId,
      prompt: request.prompt,
      expected: ["subject summary", "card fit notes", "accessibility alt text", "suggested metadata"],
      instruction: String(instruction ?? "").trim()
    }
  }];
}

function applyAiEditPatch(bundle, patch) {
  if (!isPlainRecord(patch) || !AI_EDIT_PATCH_OPS.has(patch.op)) {
    throw new PipelineError(`Unsupported AI edit patch op '${patch?.op}'`);
  }

  if (patch.op === "addCard") {
    const card = normalizeCard(patch.card);
    if (bundle.cards.some((candidate) => candidate.id === card.id)) {
      throw new PipelineError(`Card '${card.id}' already exists`);
    }
    bundle.cards.push(card);
    return;
  }

  if (patch.op === "updateCard") {
    const index = bundle.cards.findIndex((card) => card.id === patch.cardId);
    if (index === -1) {
      throw new PipelineError(`Card '${patch.cardId}' was not found`);
    }
    if (!isPlainRecord(patch.changes)) {
      throw new PipelineError("updateCard patch requires changes");
    }
    bundle.cards[index] = normalizeCard({ ...bundle.cards[index], ...cloneJsonValue(patch.changes, "updateCard changes") });
    return;
  }

  if (patch.op === "setChoiceLabel") {
    const choice = requirePatchChoice(bundle, patch.cardId, patch.choiceId);
    if (typeof patch.label !== "string") {
      throw new PipelineError("setChoiceLabel patch requires a string label");
    }
    choice.label = patch.label;
    return;
  }

  if (patch.op === "setChoiceEffects") {
    const card = requirePatchCard(bundle, patch.cardId);
    const choice = requirePatchChoice(bundle, patch.cardId, patch.choiceId);
    choice.effects = normalizeEffectKeys(patch.effects ?? {});
    const index = bundle.cards.findIndex((candidate) => candidate.id === card.id);
    bundle.cards[index] = normalizeCard(card);
    return;
  }

  if (patch.op === "setMetadata") {
    if (!isPlainRecord(patch.metadata)) {
      throw new PipelineError("setMetadata patch requires metadata");
    }
    bundle.metadata = normalizeMetadata({ ...bundle.metadata, ...cloneJsonValue(patch.metadata, "patch metadata") });
    return;
  }

  if (patch.op === "upsertAsset") {
    const asset = cloneJsonValue(patch.asset, "upsertAsset asset");
    normalizeAssets([asset]);
    const index = bundle.assets.findIndex((candidate) => candidate.id === asset.id);
    if (index === -1) {
      bundle.assets.push(asset);
    } else {
      bundle.assets[index] = { ...bundle.assets[index], ...asset };
    }
  }
}

function requirePatchCard(bundle, cardId) {
  const card = bundle.cards.find((candidate) => candidate.id === cardId);
  if (!card) {
    throw new PipelineError(`Card '${cardId}' was not found`);
  }
  return card;
}

function requirePatchChoice(bundle, cardId, choiceId) {
  const card = requirePatchCard(bundle, cardId);
  const choice = card.choices.find((candidate) => candidate.id === choiceId);
  if (!choice) {
    throw new PipelineError(`Choice '${choiceId}' was not found on card '${cardId}'`);
  }
  return choice;
}

function createBundleFingerprint(bundle) {
  return createRequestId("bundle", stableStringify(createContentBundle(bundle)));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function compactCardForAi(card) {
  return {
    id: card.id,
    text: card.text ?? "",
    weight: card.weight ?? 1,
    requirements: card.requirements ?? {},
    choices: (card.choices ?? []).map((choice) => ({
      id: choice.id,
      label: choice.label ?? "",
      effects: choice.effects ?? {}
    }))
  };
}

function compactAssetForAi(asset) {
  if (!isPlainRecord(asset)) {
    return asset;
  }
  return {
    id: asset.id ?? null,
    cardId: asset.cardId ?? null,
    uri: asset.uri ?? null,
    title: asset.title ?? null,
    source: asset.source ?? asset.sourceUrl ?? null,
    metadata: asset.metadata ?? {}
  };
}

function compactDiagnosticsForAi(diagnostics) {
  return {
    schemaVersion: diagnostics.schemaVersion ?? 1,
    module: diagnostics.module ?? "ReignsAgent-Reviewer",
    healthScore: diagnostics.healthScore ?? null,
    headline: diagnostics.headline ?? null,
    coverage: diagnostics.coverage ? {
      stalledRate: diagnostics.coverage.stalledRate ?? null,
      lowCycleCards: diagnostics.coverage.lowCycleCards ?? [],
      unvisitedCards: diagnostics.coverage.unvisitedCards ?? []
    } : null,
    graph: diagnostics.graph ? {
      unreachableCards: diagnostics.graph.unreachableCards ?? [],
      unsatisfiedRequiredTags: diagnostics.graph.unsatisfiedRequiredTags ?? [],
      unsatisfiedRequiredVariables: diagnostics.graph.unsatisfiedRequiredVariables ?? [],
      unsatisfiedRequiredFactions: diagnostics.graph.unsatisfiedRequiredFactions ?? []
    } : null,
    warnings: diagnostics.diagnostics?.warnings ?? diagnostics.warnings ?? []
  };
}

function projectGaugeLabels(metadata) {
  const gauges = metadata?.presentation?.gauges;
  if (!isPlainRecord(gauges)) {
    return {};
  }
  const labels = {};
  for (const [key, value] of Object.entries(gauges)) {
    if (isPlainRecord(value) && typeof value.label === "string") {
      labels[key] = value.label;
    }
  }
  return labels;
}

function uniqueCardId(cards, base) {
  const existing = new Set(cards.map((card) => card.id));
  let candidate = base || "ai-card";
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function uniqueAssetId(assets, base) {
  const existing = new Set(assets.map((asset) => asset.id));
  let candidate = base || "ai-asset";
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "ai-card";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => (typeof entry === "string" ? entry.trim() : entry)).filter(isNonEmptyString))];
}

function cloneJsonValue(value, context) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch (error) {
    throw new PipelineError(`${context} must be JSON-safe: ${error.message}`);
  }
}

function roundNumber(value) {
  return Math.round(value * 100) / 100;
}

function createRequestId(purpose, text) {
  let hash = 2166136261;
  const input = `${purpose}:${text}`;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${purpose}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeFactionKey(faction) {
  if (PIPELINE_FACTIONS.has(faction)) {
    return faction;
  }
  return LEGACY_FACTION_KEYS[faction] ?? null;
}

function normalizeFactionValueMap(values, context) {
  if (!isPlainRecord(values)) {
    throw new PipelineError(`${context} must be an object`);
  }

  const normalized = {};
  const sources = {};
  for (const [faction, value] of Object.entries(values)) {
    const key = normalizeFactionKey(faction);
    if (!key) {
      throw new PipelineError(`${context} has unknown faction '${faction}'`);
    }
    if (sources[key] !== undefined) {
      throw new PipelineError(`${context} defines both '${sources[key]}' and '${faction}' for '${key}'`);
    }
    sources[key] = faction;
    normalized[key] = value;
  }
  return normalized;
}

function cardGenerationSchema() {
  return {
    type: "object",
    required: ["cards"],
    properties: {
      cards: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "text", "choices"]
        }
      }
    }
  };
}

function aiEditProposalSchema() {
  return {
    type: "object",
    required: ["proposals"],
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "title", "patches"]
        }
      }
    }
  };
}

function mediaGenerationPreviewSchema() {
  return {
    type: "object",
    required: ["prompt", "asset"],
    properties: {
      prompt: { type: "string" },
      asset: { type: "object" }
    }
  };
}

function mediaAnalysisPreviewSchema() {
  return {
    type: "object",
    required: ["analysis"],
    properties: {
      analysis: { type: "object" }
    }
  };
}
