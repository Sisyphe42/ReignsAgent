#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyReleaseMetadata } from "./release-metadata.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = parseArgs(process.argv.slice(2));
const tag = args.tag ?? (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
const result = await verifyReleaseMetadata(resolve(args.root ?? ROOT), { tag });
console.log(JSON.stringify({ verified: true, ...result }, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || !["--root", "--tag"].includes(key)) {
      throw new Error("Usage: node scripts/verify-release-metadata.mjs [--root <directory>] [--tag <vX.Y.Z>]");
    }
    parsed[key.slice(2)] = value;
  }
  return parsed;
}
