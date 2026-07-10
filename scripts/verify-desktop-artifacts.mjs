#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root);
if (!(await stat(root)).isDirectory()) throw new Error(`Desktop artifact root is not a directory: ${root}`);

const requiredExtensions = {
  win32: [".exe", ".nupkg"],
  darwin: [".dmg", ".zip"],
  linux: [".deb", ".rpm"]
}[args.platform];
if (!requiredExtensions) throw new Error(`Unsupported desktop platform '${args.platform}'.`);

const files = await collectFiles(root);
for (const extension of requiredExtensions) {
  if (!files.some((file) => extname(file).toLowerCase() === extension)) {
    throw new Error(`Desktop artifacts for ${args.platform} are missing a '${extension}' file.`);
  }
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
