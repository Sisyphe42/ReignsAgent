#!/usr/bin/env node
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assembleCreatorRuntime } from "./runtime-files.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const targetDir = join(ROOT, "apps/desktop-electron/runtime");

try {
  if (!(await stat(join(ROOT, "apps/creator-web/dist"))).isDirectory()) throw new Error();
} catch {
  throw new Error("Creator build missing. Run npm run build:dashboard before desktop:prepare.");
}

await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
const files = await assembleCreatorRuntime({ rootDir: ROOT, targetDir });
await writeFile(join(targetDir, "package.json"), `${JSON.stringify({
  name: "reigns-agent-runtime",
  private: true,
  type: "module"
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ prepared: true, targetDir, fileCount: files.length + 1 }, null, 2));
