#!/usr/bin/env node
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import packagerConfig from "../apps/desktop-electron/packager.config.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const desktopRoot = resolve(ROOT, "apps/desktop-electron");
const desktopRequire = createRequire(resolve(desktopRoot, "package.json"));
const packagerModule = desktopRequire("@electron/packager");
const packager = packagerModule.packager ?? packagerModule.default ?? packagerModule;
const args = parseArgs(process.argv.slice(2));
const outputPaths = await packager({
  ...packagerConfig,
  dir: desktopRoot,
  out: resolve(desktopRoot, "out"),
  overwrite: true,
  platform: process.platform,
  arch: args.arch ?? process.arch
});

console.log(JSON.stringify({ packaged: true, outputPaths }, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inlineValue] = argv[index].split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (key !== "--arch" || !value) {
      throw new Error("Usage: node scripts/package-desktop.mjs [--arch <architecture>]");
    }
    parsed.arch = value;
    if (inlineValue === undefined) index += 1;
  }
  return parsed;
}
