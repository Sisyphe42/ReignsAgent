#!/usr/bin/env node
import { copyFile, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareGameBuild, serializeBuild, stitchPlayerRuntime, validatePlayerCards } from "../packages/interface/src/index.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB_ROOT = join(ROOT, "packages/interface/web");

/**
 * build-game.mjs assembles a deployable Reigns-style game from a content bundle.
 *
 * The deployable bundle is a single .game.json containing the prepared build
 * manifest plus the headless player runtime as an embedded text asset. It only
 * needs @reigns-agent/core at runtime; no AI pipeline, reviewer, or dashboard
 * is shipped to players.
 *
 * Usage:
 *   node scripts/build-game.mjs <content.bundle.json> [output.dir]
 */
const [contentPath, outputArg] = process.argv.slice(2);

if (!contentPath) {
  console.error("Usage: node scripts/build-game.mjs <content.bundle.json> [output.dir]");
  process.exit(1);
}

const outputPath = outputArg ?? join(process.cwd(), "dist");
const resolvedContent = resolve(contentPath);

try {
  const source = await readFile(resolvedContent, "utf8");
  const bundle = JSON.parse(source);
  const cards = Array.isArray(bundle) ? bundle : bundle.cards;

  const playerValidation = validatePlayerCards(cards);
  if (!playerValidation.valid) {
    console.error(`Cannot build: player cards are invalid:\n- ${playerValidation.errors.join("\n- ")}`);
    process.exit(1);
  }

  const build = prepareGameBuild({
    editor: {
      cards,
      metadata: bundle.metadata ?? {},
      assets: bundle.assets ?? []
    }
  });

  const playerRuntimeTemplate = await readFile(join(ROOT, "packages/interface/web/player-runtime.js"), "utf8");
  const coreSource = await readFile(join(ROOT, "packages/core/src/index.js"), "utf8");
  const playerRuntime = stitchPlayerRuntime(playerRuntimeTemplate, coreSource);

  const deployable = {
    ...build,
    player: {
      ...build.player,
      runtime: playerRuntime,
      entry: "player-runtime.js"
    }
  };

  await mkdir(outputPath, { recursive: true });

  const buildFile = join(outputPath, `${build.buildId}.game.json`);
  await writeFile(buildFile, serializeBuild(deployable), "utf8");

  const standalonePlayer = join(outputPath, "player-runtime.js");
  await writeFile(standalonePlayer, playerRuntime, "utf8");

  const playerHtml = await readFile(join(ROOT, "packages/interface/web/standalone-player.html"), "utf8");
  await writeFile(join(outputPath, "player.html"), playerHtml, "utf8");
  const staticAssets = await copyStaticBuildAssets(outputPath);
  const copiedAssets = await copyLocalBuildAssets(build.content.assets ?? [], outputPath);

  console.log(JSON.stringify({
    built: true,
    buildId: build.buildId,
    buildFile,
    playerRuntime: standalonePlayer,
    staticAssets,
    copiedAssets,
    cardCount: build.content.cards.length,
    playerChoiceModel: build.player.choiceModel
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: { name: error.name, message: error.message } }));
  process.exit(1);
}

/**
 * stitchPlayerRuntime inlines the headless core source into the player runtime,
 * replacing the CORE_IMPORT marker. The shipped player-runtime.js is then fully
 * self-contained (no repo-relative imports) and only exposes the player surface.
 */
async function copyStaticBuildAssets(outputDir) {
  const staticAssets = ["skin-catalog.js", "assets/logo-alpha.png"];
  for (const assetPath of staticAssets) {
    const source = resolve(WEB_ROOT, assetPath);
    assertWithin(WEB_ROOT, source, `Static asset '${assetPath}'`);

    const target = resolve(outputDir, assetPath);
    assertWithin(outputDir, target, `Static asset output '${assetPath}'`);

    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  return staticAssets;
}

async function copyLocalBuildAssets(assets, outputDir) {
  const copied = [];
  const seenUris = new Set();

  for (const asset of assets) {
    const uri = asset?.uri;
    if (typeof uri !== "string") {
      continue;
    }

    const normalizedUri = uri.replace(/^\.?\//, "");
    if (!normalizedUri.startsWith("assets/") || normalizedUri.includes("..")) {
      continue;
    }
    if (seenUris.has(normalizedUri)) {
      continue;
    }
    seenUris.add(normalizedUri);

    const source = resolve(WEB_ROOT, normalizedUri);
    assertWithin(WEB_ROOT, source, `Asset '${uri}'`);

    const target = resolve(outputDir, normalizedUri);
    assertWithin(outputDir, target, `Asset output '${uri}'`);

    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    copied.push(uri);
  }

  return copied;
}

function assertWithin(root, target, context) {
  const relativePath = relative(resolve(root), resolve(target));
  if (relativePath.startsWith("..") || relativePath === "" || resolve(target).includes("\0")) {
    throw new Error(`${context} escapes its expected root`);
  }
}
