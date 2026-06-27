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
  const warnings = report?.diagnostics?.warnings ?? [];
  const actions = [];
  const seenActions = new Set();

  for (const warning of warnings) {
    if (warning.code === "never_visited_cards") {
      addAction(actions, seenActions, {
        type: "relax_requirements",
        severity: warning.severity ?? "error",
        target: warning.cardIds ?? [],
        reason: warning.message,
        sourceWarning: warning.code
      });
    }

    if (warning.code === "unreachable_cards") {
      addAction(actions, seenActions, {
        type: "repair_reachability",
        severity: warning.severity ?? "error",
        target: warning.cardIds ?? [],
        reason: warning.message,
        sourceWarning: warning.code
      });
    }

    if (warning.code === "low_card_cycle_coverage") {
      addAction(actions, seenActions, {
        type: "raise_card_exposure",
        severity: warning.severity ?? "warning",
        target: (warning.cards ?? []).map((card) => card.cardId),
        reason: warning.message,
        sourceWarning: warning.code
      });
    }

    if (warning.code === "unsatisfied_required_tags") {
      addAction(actions, seenActions, {
        type: "add_tag_producers",
        severity: warning.severity ?? "error",
        target: warning.tags ?? [],
        reason: warning.message,
        sourceWarning: warning.code
      });
    }

    if (warning.code === "unsatisfied_required_variables") {
      addAction(actions, seenActions, {
        type: "add_variable_producers",
        severity: warning.severity ?? "error",
        target: warning.variables ?? [],
        reason: warning.message,
        sourceWarning: warning.code
      });
    }

    if (warning.code === "unsatisfied_required_factions") {
      addAction(actions, seenActions, {
        type: "adjust_faction_requirements",
        severity: warning.severity ?? "error",
        target: warning.factions ?? [],
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
        target: warning.faction ?? "all",
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
  constructor(message) {
    super(message);
    this.name = "PipelineError";
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

function addAction(actions, seenActions, action) {
  const key = `${action.type}:${JSON.stringify(action.target)}`;

  if (seenActions.has(key)) {
    return;
  }

  seenActions.add(key);
  actions.push(action);
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
