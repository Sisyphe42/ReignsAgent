import { readFile, writeFile } from "node:fs/promises";

const CSV_COLUMNS = [
  "cardId",
  "text",
  "weight",
  "requirementsJson",
  "choiceId",
  "choiceLabel",
  "effectsJson"
];
const PIPELINE_FACTIONS = new Set(["faith", "people", "military", "treasury"]);
const REQUIREMENT_KEYS = new Set(["allTags", "anyTags", "noneTags", "variables"]);
const EFFECT_KEYS = new Set(["tags", "variables", "factions", "activateHooks", "dismissHooks"]);

export async function readCardsJson(path) {
  const contents = await readFile(path, "utf8");
  return parseCardsJson(contents);
}

export async function writeCardsJson(path, cards) {
  await writeFile(path, stringifyCardsJson(cards), "utf8");
}

export function parseCardsJson(source) {
  const data = typeof source === "string" ? JSON.parse(source) : source;
  const cards = Array.isArray(data) ? data : data?.cards;

  if (!Array.isArray(cards)) {
    throw new PipelineError("JSON card data must be an array or an object with a cards array");
  }

  return normalizeCards(cards);
}

export function stringifyCardsJson(cards) {
  return `${JSON.stringify({ cards: normalizeCards(cards) }, null, 2)}\n`;
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

export function createLLMConnector(connector) {
  if (!connector?.name) {
    throw new PipelineError("Connector requires a name");
  }

  if (typeof connector.generateText !== "function") {
    throw new PipelineError("Connector requires generateText(request)");
  }

  return {
    name: connector.name,
    generateText: connector.generateText,
    generateAsset: connector.generateAsset
  };
}

export async function generateCardDrafts({ connector, theme, count, constraints = {}, diagnostics = null }) {
  const llm = createLLMConnector(connector);
  const prompt = buildCardGenerationPrompt({ theme, count, constraints, diagnostics });
  const response = await llm.generateText({
    purpose: "card_generation",
    prompt,
    responseFormat: "json",
    schema: cardGenerationSchema()
  });

  return parseCardsJson(extractTextPayload(response));
}

export async function generateAssetDrafts({ connector, cards, style = "minimal monochrome card portrait" }) {
  const llm = createLLMConnector(connector);

  if (typeof llm.generateAsset !== "function") {
    throw new PipelineError("Connector requires generateAsset(request) for asset generation");
  }

  const assets = [];
  for (const card of cards.map(normalizeCard)) {
    assets.push(
      await llm.generateAsset({
        purpose: "card_asset_generation",
        cardId: card.id,
        prompt: `${style}: ${card.text ?? card.id}`
      })
    );
  }

  return assets;
}

export function createDiagnosticFeedback(report) {
  const warnings = report?.diagnostics?.warnings ?? [];
  const actions = [];

  for (const warning of warnings) {
    if (warning.code === "never_visited_cards") {
      actions.push({
        type: "relax_requirements",
        target: warning.cardIds ?? [],
        reason: warning.message
      });
    }

    if (warning.code === "unsatisfied_required_tags") {
      actions.push({
        type: "add_tag_producers",
        target: warning.tags ?? [],
        reason: warning.message
      });
    }

    if (warning.code === "unsatisfied_required_variables") {
      actions.push({
        type: "add_variable_producers",
        target: warning.variables ?? [],
        reason: warning.message
      });
    }

    if (warning.code === "stalled_cycles") {
      actions.push({
        type: "add_fallback_cards",
        target: "scheduler",
        reason: warning.message
      });
    }

    if (warning.code === "dominant_game_over_faction") {
      actions.push({
        type: "rebalance_faction_pressure",
        target: warning.faction,
        reason: warning.message
      });
    }
  }

  const gameOverByFaction = report?.summary?.gameOverByFaction ?? {};
  const cycles = report?.parameters?.cycles ?? 0;
  for (const [faction, count] of Object.entries(gameOverByFaction)) {
    if (cycles > 0 && count / cycles > 0.45) {
      actions.push({
        type: "rebalance_faction_pressure",
        target: faction,
        reason: `More than 45% of simulated endings hit ${faction}.`
      });
    }
  }

  return {
    schemaVersion: 1,
    sourceModule: report?.module ?? "ReignsAgent-Reviewer",
    actions
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
    "Each card needs id, text, and two concise choices with faction/tag effects.",
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
    requirements: card.requirements === undefined ? {} : card.requirements,
    choices: card.choices.map((choice) => {
      if (!choice?.id) {
        throw new PipelineError(`Card '${card.id}' has a choice without an id`);
      }

      return {
        ...choice,
        effects: choice.effects === undefined ? {} : choice.effects
      };
    })
  };
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
        if (!PIPELINE_FACTIONS.has(faction)) {
          errors.push(`${context}.factions has unknown faction '${faction}'`);
        }

        if (!Number.isFinite(delta)) {
          errors.push(`${context}.factions.${faction} must be finite`);
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
    return response;
  }

  if (typeof response?.text === "string") {
    return response.text;
  }

  throw new PipelineError("generateText must return a string or an object with a text field");
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
