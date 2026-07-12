import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const protectedRoots = [
  "packages/core/src",
  "packages/pipeline/src",
  "packages/reviewer/src",
  "packages/interface/src",
  "apps/creator-web/src",
  "apps/creator-server/src"
];
const importPattern = /(?:import|export)\s+(?:[^'\"]*?\s+from\s+)?["']([^"']+)["']/g;
const violations = [];

for (const root of protectedRoots) {
  for (const file of await collectJavaScriptFiles(root)) {
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(importPattern)) {
      if (match[1] === "electron" || match[1].startsWith("electron/")) {
        violations.push(`${file}: Electron imports are only allowed in apps/desktop-electron`);
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Desktop boundary violations:\n${violations.join("\n")}`);
}

console.log("Desktop boundary verification passed.");

async function collectJavaScriptFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectJavaScriptFiles(path));
    else if (entry.isFile() && /\.(js|jsx|mjs)$/.test(entry.name)) result.push(path);
  }
  return result;
}
