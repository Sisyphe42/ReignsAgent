import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { validatePlayerCards } from "../packages/interface/src/index.js";
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

const feedback = cliResult.report.diagnostics.warnings.length === 0 ? null : cliResult.report.diagnostics.warnings;
if (feedback !== null && !Array.isArray(feedback)) {
  throw new Error("Content tool fixture warnings are malformed");
}

const playerBuild = await verifyPlayerBuildSmoke();

console.log(`Fixture verification passed for ${fixturePath} and ${playerBuild.cardCount} player cards.`);

async function verifyPlayerBuildSmoke() {
  const playerFixturePath = "fixtures/content/oss-court.cards.json";
  const playerCards = await readCardsJson(playerFixturePath);
  const playerValidation = validatePlayerCards(playerCards);

  if (!playerValidation.valid) {
    throw new Error(`Player fixture validation failed:\n${playerValidation.errors.join("\n")}`);
  }

  const outputDir = await mkdtemp(join(tmpdir(), "reigns-agent-player-build-"));

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/build-game.mjs",
      playerFixturePath,
      outputDir
    ]);
    const result = JSON.parse(stdout);

    if (!result.built || result.playerChoiceModel !== "binary") {
      throw new Error("Player build did not produce a binary deployable manifest");
    }

    if (!Array.isArray(result.copiedAssets) || result.copiedAssets.length < 1) {
      throw new Error("Player build did not copy local sample art assets");
    }

    const files = await readdir(outputDir);
    if (!files.includes("player.html") || !files.includes("player-runtime.js")) {
      throw new Error("Player build did not emit standalone player assets");
    }

    const sampleAsset = join(outputDir, "assets/sample/castle.svg");
    if (!files.includes("assets") || !(await readFile(sampleAsset, "utf8")).includes("<svg")) {
      throw new Error("Player build did not emit sample art assets");
    }

    const runtimeSource = await readFile(result.playerRuntime, "utf8");
    if (runtimeSource.includes("CORE_IMPORT_MARKER") || /\sfrom\s+["']/.test(runtimeSource)) {
      throw new Error("Player runtime was not self-contained after build");
    }

    const build = JSON.parse(await readFile(result.buildFile, "utf8"));
    await writeFile(join(outputDir, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`, "utf8");
    const runtimeModule = await import(`${pathToFileURL(result.playerRuntime).href}?smoke=${Date.now()}`);

    if (runtimeModule.PLAYER_RUNTIME_VERSION !== 1) {
      throw new Error("Player runtime export version is missing");
    }

    const player = runtimeModule.createPlayer(build, { rng: () => 0 });
    const start = player.start();

    if (!start.currentCard || Object.keys(start.factions).length !== 4) {
      throw new Error("Player runtime could not start from the deployable build");
    }

    const afterSwipe = player.swipe("left");
    if (afterSwipe.turn !== 1) {
      throw new Error("Player runtime did not apply a left swipe");
    }

    return result;
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}
