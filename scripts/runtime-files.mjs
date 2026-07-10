import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

export const CREATOR_RUNTIME_ENTRIES = Object.freeze([
  ["apps/creator-web/dist", "creator"],
  ["apps/creator-server/src", "apps/creator-server/src"],
  ["scripts/build-game.mjs", "scripts/build-game.mjs"],
  ["packages/core/src", "packages/core/src"],
  ["packages/pipeline/src", "packages/pipeline/src"],
  ["packages/reviewer/src", "packages/reviewer/src"],
  ["packages/interface/src", "packages/interface/src"],
  ["packages/interface/web", "packages/interface/web"],
  ["fixtures/content", "fixtures/content"]
]);

export async function assembleCreatorRuntime({ rootDir, targetDir }) {
  for (const [source, target] of CREATOR_RUNTIME_ENTRIES) {
    await copyTree(join(rootDir, source), join(targetDir, target));
  }
  const files = await collectFiles(targetDir);
  validateCreatorRuntime(files, targetDir);
  return files;
}

export async function collectFiles(root) {
  const files = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort();
}

export function validateCreatorRuntime(files, runtimeRoot) {
  const names = files.map((file) => toPosix(relative(runtimeRoot, file)));
  const required = [
    "creator/index.html",
    "apps/creator-server/src/server.mjs",
    "scripts/build-game.mjs",
    "packages/core/src/index.js",
    "packages/pipeline/src/index.js",
    "packages/reviewer/src/index.js",
    "packages/interface/src/index.js",
    "packages/interface/web/player.html",
    "fixtures/content/oss-court.cards.json"
  ];
  for (const requiredPath of required) {
    if (!names.includes(requiredPath)) {
      throw new Error(`Creator runtime is missing required file '${requiredPath}'.`);
    }
  }

  const forbidden = names.find((name) =>
    name === ".env"
    || name.startsWith("node_modules/")
    || name.includes("/node_modules/")
    || name.startsWith("test/")
    || name.includes("/test/")
    || name.includes(".test.")
    || name.startsWith("apps/creator-web/src/")
  );
  if (forbidden) {
    throw new Error(`Creator runtime contains forbidden path '${forbidden}'.`);
  }
  return names;
}

async function copyTree(source, target) {
  const sourceStat = await stat(source);
  if (sourceStat.isDirectory()) {
    await mkdir(target, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await copyTree(join(source, entry.name), join(target, entry.name));
    }
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

function toPosix(path) {
  return path.split(sep).join("/");
}
