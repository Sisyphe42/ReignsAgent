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

  return cards.map(normalizeCard);
}

export function stringifyCardsJson(cards) {
  return `${JSON.stringify({ cards: cards.map(normalizeCard) }, null, 2)}\n`;
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

  return [...cards.values()].map(normalizeCard);
}

export function stringifyCardsCsv(cards) {
  const rows = [CSV_COLUMNS];

  for (const card of cards.map(normalizeCard)) {
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

    if (warning.code === "stalled_cycles") {
      actions.push({
        type: "add_fallback_cards",
        target: "scheduler",
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
    requirements: card.requirements ?? {},
    choices: card.choices.map((choice) => {
      if (!choice?.id) {
        throw new PipelineError(`Card '${card.id}' has a choice without an id`);
      }

      return {
        ...choice,
        effects: choice.effects ?? {}
      };
    })
  };
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
