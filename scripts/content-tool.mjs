#!/usr/bin/env node
import { extname } from "node:path";
import { readFile } from "node:fs/promises";

import {
  createDiagnosticFeedback,
  readCardsCsv,
  readCardsJson,
  validateCardSet,
  writeCardsCsv,
  writeCardsJson
} from "../packages/pipeline/src/index.js";
import { runMonteCarloReview } from "../packages/reviewer/src/index.js";

const [command, filePath, ...flags] = process.argv.slice(2);

try {
  if (!command || !filePath || !["validate", "review", "convert", "feedback"].includes(command)) {
    usage();
    process.exitCode = 1;
  } else if (command === "validate") {
    const cards = await loadCards(filePath);
    const validation = validateCardSet(cards);
    writeJson({ filePath, cards: cards.length, validation });
    if (!validation.valid) {
      process.exitCode = 1;
    }
  } else if (command === "review") {
    const cards = await loadCards(filePath);
    const validation = validateCardSet(cards);
    if (!validation.valid) {
      writeJson({ filePath, cards: cards.length, validation });
      process.exitCode = 1;
    } else {
      const options = parseReviewFlags(flags);
      const report = runMonteCarloReview({ cards, ...options });
      writeJson({ filePath, cards: cards.length, validation, report });
    }
  } else if (command === "convert") {
    const outputPath = flags[0];
    if (!outputPath) {
      throw new Error("convert requires an output path");
    }

    const cards = await loadCards(filePath);
    const validation = validateCardSet(cards);
    if (!validation.valid) {
      writeJson({ filePath, cards: cards.length, validation });
      process.exitCode = 1;
    } else {
      await writeCards(outputPath, cards);
      writeJson({ inputPath: filePath, outputPath, cards: cards.length, validation });
    }
  } else if (command === "feedback") {
    const report = JSON.parse(await readFile(filePath, "utf8"));
    writeJson({
      filePath,
      feedback: createDiagnosticFeedback(report)
    });
  }
} catch (error) {
  writeJson({
    error: {
      name: error.name,
      message: error.message
    }
  });
  process.exitCode = 1;
}

async function loadCards(filePath) {
  const extension = extname(filePath).toLowerCase();

  if (extension === ".csv") {
    return readCardsCsv(filePath);
  }

  return readCardsJson(filePath);
}

async function writeCards(filePath, cards) {
  const extension = extname(filePath).toLowerCase();

  if (extension === ".csv") {
    await writeCardsCsv(filePath, cards);
    return;
  }

  await writeCardsJson(filePath, cards);
}

function parseReviewFlags(flags) {
  const options = {
    cycles: 1000,
    maxTurns: 50,
    seed: 1
  };

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    const next = flags[index + 1];

    if (flag === "--cycles") {
      options.cycles = parsePositiveInteger(next, "cycles");
      index += 1;
    } else if (flag === "--maxTurns") {
      options.maxTurns = parsePositiveInteger(next, "maxTurns");
      index += 1;
    } else if (flag === "--seed") {
      options.seed = parseInteger(next, "seed");
      index += 1;
    } else {
      throw new Error(`Unknown flag '${flag}'`);
    }
  }

  return options;
}

function parsePositiveInteger(value, name) {
  const parsed = parseInteger(value, name);
  if (parsed <= 0) {
    throw new Error(`${name} must be positive`);
  }
  return parsed;
}

function parseInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

function writeJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function usage() {
  writeJson({
    usage: [
      "node scripts/content-tool.mjs validate <cards.json|cards.csv>",
      "node scripts/content-tool.mjs review <cards.json|cards.csv> [--cycles n] [--maxTurns n] [--seed n]",
      "node scripts/content-tool.mjs convert <cards.json|cards.csv> <output.json|output.csv>",
      "node scripts/content-tool.mjs feedback <review-report.json>"
    ]
  });
}
