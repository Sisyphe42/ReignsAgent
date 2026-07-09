#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const roots = process.argv.slice(2);

if (roots.length === 0) {
  console.error("Usage: node scripts/run-tests.mjs <root> [root...]");
  process.exit(1);
}

const ignoredDirectories = new Set(["node_modules", "dist", "coverage"]);

function collectTests(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        collectTests(fullPath, files);
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }

  return files;
}

const testFiles = roots
  .map((root) => resolve(root))
  .flatMap((root) => {
    const stats = statSync(root, { throwIfNoEntry: false });
    if (!stats) {
      console.error(`Test root not found: ${root}`);
      process.exit(1);
    }

    return stats.isDirectory() ? collectTests(root) : [root];
  })
  .sort((left, right) => left.localeCompare(right));

if (testFiles.length === 0) {
  console.error(`No test files found under: ${roots.join(", ")}`);
  process.exit(1);
}

const displayFiles = testFiles.map((file) => relative(process.cwd(), file).split(sep).join("/"));
console.log(`Running ${testFiles.length} test file${testFiles.length === 1 ? "" : "s"}:`);
for (const file of displayFiles) {
  console.log(`- ${file}`);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

console.error(result.error?.message ?? "Test process exited without a status code.");
process.exit(1);
