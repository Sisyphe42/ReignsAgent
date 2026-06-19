import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { readCardsJson, validateCardSet } from "../packages/pipeline/src/index.js";
import { runMonteCarloReview } from "../packages/reviewer/src/index.js";

const execFileAsync = promisify(execFile);
const fixturePath = "fixtures/content/minimal.cards.json";
const cards = await readCardsJson(fixturePath);
const validation = validateCardSet(cards);

if (!validation.valid) {
  throw new Error(`Fixture validation failed:\n${validation.errors.join("\n")}`);
}

const report = runMonteCarloReview({
  cards,
  cycles: 25,
  maxTurns: 10,
  seed: 11
});

if (report.module !== "ReignsAgent-Reviewer") {
  throw new Error("Fixture review did not return a reviewer report");
}

const { stdout } = await execFileAsync(process.execPath, [
  "scripts/content-tool.mjs",
  "review",
  fixturePath,
  "--cycles",
  "5",
  "--maxTurns",
  "5",
  "--seed",
  "2"
]);
const cliResult = JSON.parse(stdout);

if (!cliResult.validation.valid || cliResult.report.module !== "ReignsAgent-Reviewer") {
  throw new Error("Content tool fixture review failed");
}

console.log(`Fixture verification passed for ${fixturePath}.`);

