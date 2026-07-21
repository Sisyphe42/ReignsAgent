#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assembleReleaseAssets } from "./release-assets.mjs";
import { verifyReleaseMetadata } from "./release-metadata.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = parseArgs(process.argv.slice(2));
const metadata = await verifyReleaseMetadata(ROOT, { tag: args.tag });
const result = await assembleReleaseAssets({
  inputRoot: resolve(args.input),
  outputRoot: resolve(args.output),
  version: metadata.version
});
console.log(JSON.stringify({ assembled: true, version: metadata.version, ...result }, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || !["--input", "--output", "--tag"].includes(key)) {
      throw new Error("Usage: node scripts/assemble-release.mjs --input <directory> --output <directory> [--tag <vX.Y.Z>]");
    }
    parsed[key.slice(2)] = value;
  }
  if (!parsed.input || !parsed.output) throw new Error("--input and --output are required.");
  return parsed;
}
