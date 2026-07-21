#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readZipEntryNames, validatePortableArchiveEntries } from "./release-archive.mjs";
import { verifyReleaseMetadata } from "./release-metadata.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = parseArgs(process.argv.slice(2));
const metadata = await verifyReleaseMetadata(ROOT, { tag: args.tag });
const artifactRoot = resolve(args.root);
const expectedName = `reigns-agent-${metadata.version}.zip`;
const zipFiles = (await readdir(artifactRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip"));
const archiveEntry = zipFiles.find((entry) => entry.name === expectedName);
if (!archiveEntry) throw new Error(`Expected Node release archive '${expectedName}' under '${artifactRoot}'.`);
const archivePath = join(artifactRoot, archiveEntry.name);
const names = await readZipEntryNames(archivePath);
validatePortableArchiveEntries(names, { kind: "node", version: metadata.version });
console.log(JSON.stringify({ verified: true, archive: basename(archivePath), entries: names.length }, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || !["--root", "--tag"].includes(key)) {
      throw new Error("Usage: node scripts/verify-release-artifacts.mjs --root <directory> [--tag <vX.Y.Z>]");
    }
    parsed[key.slice(2)] = value;
  }
  if (!parsed.root) throw new Error("--root is required.");
  return parsed;
}
