import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const roots = ["packages", "scripts", "test", "apps/creator-server", "apps/desktop-electron"];
const ignoredDirectories = new Set(["dist", "node_modules", "out", "runtime"]);
const files = [];

for (const root of roots) {
  files.push(...(await collectJavaScriptFiles(root)));
}

for (const file of files) {
  await execFileAsync(process.execPath, ["--check", file]);
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      result.push(...(await collectJavaScriptFiles(path)));
      continue;
    }

    if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) {
      result.push(path);
    }
  }

  return result;
}
