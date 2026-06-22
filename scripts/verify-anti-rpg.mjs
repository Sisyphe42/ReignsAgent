import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const roots = ["packages", "scripts", "test"];
const bannedPatterns = [
  /\binventory\b/i,
  /\bequipment\b/i,
  /\bpets?\b/i,
  /\bshops?\b/i,
  /\brarity\b/i,
  /\bcrafting\b/i,
  /\bgear\b/i,
  /\bskill[- ]tree\b/i,
  /\bcharacter[- ]build\b/i,
  /\bstatus effects?\b/i
];
const violations = [];

for (const root of roots) {
  for (const file of await collectJavaScriptFiles(root)) {
    if (file.endsWith(`${separator()}verify-anti-rpg.mjs`)) {
      continue;
    }

    const text = await readFile(file, "utf8");

    for (const pattern of bannedPatterns) {
      const match = text.match(pattern);
      if (match) {
        violations.push(`${file}: banned upper-level RPG term '${match[0]}'`);
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Anti-RPG verification failed:\n${violations.join("\n")}`);
}

console.log("Anti-RPG verification passed for implementation scripts and tests.");

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      result.push(...(await collectJavaScriptFiles(path)));
      continue;
    }

    if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) {
      result.push(path);
    }
  }

  return result;
}

function separator() {
  return process.platform === "win32" ? "\\" : "/";
}
