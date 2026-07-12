#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root);
if (!(await stat(root)).isDirectory()) throw new Error(`Desktop artifact root is not a directory: ${root}`);

if (!["win32", "darwin", "linux"].includes(args.platform)) {
  throw new Error(`Unsupported desktop platform '${args.platform}'.`);
}

const files = await collectFiles(root);
const zipFiles = files.filter((file) => extname(file).toLowerCase() === ".zip");
if (zipFiles.length !== 1) {
  throw new Error(`Portable desktop artifacts for ${args.platform} require exactly one ZIP file; found ${zipFiles.length}.`);
}
if (!zipFiles[0].toLowerCase().includes(`-${args.platform.toLowerCase()}-`)) {
  throw new Error(`Portable ZIP filename does not identify platform '${args.platform}': ${zipFiles[0]}`);
}
const installerExtensions = new Set([".deb", ".dmg", ".exe", ".nupkg", ".rpm"]);
const installer = files.find((file) => installerExtensions.has(extname(file).toLowerCase()));
if (installer) {
  throw new Error(`Portable desktop artifacts contain installer '${installer}'.`);
}

console.log(JSON.stringify({ verified: true, platform: args.platform, root, files }, null, 2));

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || !["--platform", "--root"].includes(key)) {
      throw new Error("Usage: node scripts/verify-desktop-artifacts.mjs --platform <win32|darwin|linux> --root <directory>");
    }
    parsed[key.slice(2)] = value;
  }
  if (!parsed.platform || !parsed.root) throw new Error("Both --platform and --root are required.");
  return parsed;
}
