#!/usr/bin/env node
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";
import { assembleCreatorRuntime, collectFiles } from "./runtime-files.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = parseArgs(process.argv.slice(2));
const rootPackage = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
const releaseName = `reigns-agent-${rootPackage.version}`;
const outputRoot = resolve(args.output ?? join(ROOT, "dist"));
const releaseRoot = join(outputRoot, releaseName);
const archivePath = join(outputRoot, `${releaseName}.zip`);

await assertDirectory(
  join(ROOT, "apps/creator-web/dist"),
  "Creator build missing. Run npm run build:dashboard first."
);
await rm(releaseRoot, { recursive: true, force: true });
await rm(archivePath, { force: true });
await mkdir(releaseRoot, { recursive: true });

await assembleCreatorRuntime({ rootDir: ROOT, targetDir: releaseRoot });

const releaseEntries = [
  ["LICENSE", "LICENSE.reigns-agent.txt"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
  ["scripts/release/start.mjs", "start.mjs"],
  ["scripts/release/start.cmd", "start.cmd"],
  ["scripts/release/start.sh", "start.sh"],
  ["scripts/release/README.md", "README.md"]
];

for (const [source, target] of releaseEntries) {
  await copyFile(join(ROOT, source), join(releaseRoot, target));
}

const releasePackage = {
  name: "reigns-agent-distribution",
  version: rootPackage.version,
  private: true,
  type: "module",
  scripts: {
    start: "node start.mjs",
    "build:game": "node scripts/build-game.mjs"
  },
  engines: { node: ">=22" }
};
await writeFile(join(releaseRoot, "package.json"), `${JSON.stringify(releasePackage, null, 2)}\n`, "utf8");

const files = await collectFiles(releaseRoot);
validateReleaseFiles(files);
const archiveEntries = {};
for (const file of files) {
  const archiveName = `${releaseName}/${toPosix(relative(releaseRoot, file))}`;
  archiveEntries[archiveName] = new Uint8Array(await readFile(file));
}
await writeFile(archivePath, zipSync(archiveEntries, { level: 6 }));

console.log(JSON.stringify({
  built: true,
  version: rootPackage.version,
  releaseRoot,
  archivePath,
  fileCount: files.length
}, null, 2));

function validateReleaseFiles(files) {
  const names = files.map((file) => toPosix(relative(releaseRoot, file)));
  const required = [
    "creator/index.html",
    "apps/creator-server/src/server.mjs",
    "scripts/build-game.mjs",
    "packages/core/src/index.js",
    "packages/pipeline/src/index.js",
    "packages/reviewer/src/index.js",
    "packages/interface/src/index.js",
    "packages/workspace/src/index.js",
    "packages/interface/web/player.html",
    "fixtures/content/oss-court.cards.json",
    "start.mjs",
    "start.cmd",
    "start.sh",
    "README.md",
    "LICENSE.reigns-agent.txt",
    "THIRD_PARTY_NOTICES.md",
    "package.json"
  ];
  for (const requiredPath of required) {
    if (!names.includes(requiredPath)) {
      throw new Error(`Release is missing required file '${requiredPath}'.`);
    }
  }

  const forbidden = names.find((name) =>
    name === ".env"
    || name === "ReignsAgentData"
    || name.startsWith("ReignsAgentData/")
    || name.startsWith("node_modules/")
    || name.includes("/node_modules/")
    || name.startsWith("test/")
    || name.includes("/test/")
    || name.includes(".test.")
    || name.startsWith("apps/creator-web/src/")
  );
  if (forbidden) {
    throw new Error(`Release contains forbidden path '${forbidden}'.`);
  }
}

async function assertDirectory(path, message) {
  try {
    if ((await stat(path)).isDirectory()) return;
  } catch {}
  throw new Error(message);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output" && argv[index + 1]) {
      parsed.output = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(
      `Unknown or incomplete argument '${argv[index]}'. Usage: node scripts/build-release.mjs [--output <directory>]`
    );
  }
  return parsed;
}

function toPosix(path) {
  return path.split(sep).join("/");
}
