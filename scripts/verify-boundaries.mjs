import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const sourceFiles = await collectJavaScriptFiles("packages");
const importPattern = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;
const packageRoots = new Map(["core", "reviewer", "pipeline", "interface", "workspace"].map((name) => [name, resolve("packages", name)]));
const violations = [];

for (const file of sourceFiles.filter((path) => path.includes(`${separator()}src${separator()}`))) {
  const text = await readFile(file, "utf8");
  const packageName = packageNameFromPath(file);

  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1];

    if (specifier.startsWith("node:")) {
      continue;
    }

    if (!specifier.startsWith(".")) {
      violations.push(`${file}: package imports are not allowed in source yet: '${specifier}'`);
      continue;
    }

    const target = resolve(dirname(file), specifier);
    const targetPackage = packageNameForResolvedPath(target);

    if (!isAllowed(packageName, targetPackage)) {
      violations.push(`${file}: ${packageName} cannot import ${targetPackage ?? "outside packages"} via '${specifier}'`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Module boundary violations:\n${violations.join("\n")}`);
}

console.log("Module boundary verification passed.");

function isAllowed(packageName, targetPackage) {
  if (packageName === "core") {
    return targetPackage === "core";
  }

  if (packageName === "reviewer") {
    return targetPackage === "reviewer" || targetPackage === "core";
  }

  if (packageName === "pipeline") {
    return targetPackage === "pipeline";
  }

  if (packageName === "interface") {
    return targetPackage === "interface" || targetPackage === "core" || targetPackage === "pipeline" || targetPackage === "reviewer";
  }

  if (packageName === "workspace") {
    return targetPackage === "workspace";
  }

  return false;
}

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      result.push(...(await collectJavaScriptFiles(path)));
      continue;
    }

    if (entry.isFile() && /\.js$/.test(entry.name)) {
      result.push(path);
    }
  }

  return result;
}

function packageNameFromPath(path) {
  return path.split(separator())[1];
}

function packageNameForResolvedPath(path) {
  for (const [name, root] of packageRoots.entries()) {
    if (path.startsWith(root)) {
      return name;
    }
  }

  return null;
}

function separator() {
  return process.platform === "win32" ? "\\" : "/";
}
