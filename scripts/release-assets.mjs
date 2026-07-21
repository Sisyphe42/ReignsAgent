import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { readZipEntryNames, validatePortableArchiveEntries } from "./release-archive.mjs";

export function expectedReleaseAssets(version) {
  return [
    { name: `reigns-agent-${version}.zip`, kind: "node" },
    { name: `ReignsAgent-win32-x64-${version}.zip`, kind: "desktop", platform: "win32" },
    { name: `ReignsAgent-darwin-x64-${version}.zip`, kind: "desktop", platform: "darwin" },
    { name: `ReignsAgent-darwin-arm64-${version}.zip`, kind: "desktop", platform: "darwin" },
    { name: `ReignsAgent-linux-x64-${version}.zip`, kind: "desktop", platform: "linux" }
  ];
}

export async function assembleReleaseAssets({ inputRoot, outputRoot, version }) {
  const expected = expectedReleaseAssets(version);
  const sourceFiles = await collectFiles(resolve(inputRoot));
  const unexpected = sourceFiles.find((path) => !path.toLowerCase().endsWith(".zip") && basename(path) !== "SHA256SUMS.txt");
  if (unexpected) throw new Error(`Unexpected release input '${basename(unexpected)}'.`);
  const zipFiles = sourceFiles.filter((path) => path.toLowerCase().endsWith(".zip"));
  assertExactAssetNames(zipFiles.map((path) => basename(path)), expected.map((asset) => asset.name));

  await mkdir(resolve(outputRoot), { recursive: true });
  const outputFiles = [];
  for (const asset of expected) {
    const source = zipFiles.find((path) => basename(path) === asset.name);
    validatePortableArchiveEntries(await readZipEntryNames(source), { ...asset, version });
    const target = join(resolve(outputRoot), asset.name);
    if (resolve(source) !== resolve(target)) await copyFile(source, target);
    outputFiles.push(target);
  }

  const checksumPath = join(resolve(outputRoot), "SHA256SUMS.txt");
  const lines = [];
  for (const path of [...outputFiles].sort((left, right) => basename(left).localeCompare(basename(right)))) {
    lines.push(`${await sha256(path)}  ${basename(path)}`);
  }
  await writeFile(checksumPath, `${lines.join("\n")}\n`, "utf8");
  await verifyReleaseChecksums({ root: resolve(outputRoot), checksumPath, expectedNames: expected.map((asset) => asset.name) });
  return { assets: outputFiles.map((path) => basename(path)).sort(), checksumPath };
}

export async function verifyReleaseChecksums({ root, checksumPath = join(root, "SHA256SUMS.txt"), expectedNames }) {
  const lines = (await readFile(checksumPath, "utf8")).trim().split(/\r?\n/).filter(Boolean);
  const entries = lines.map((line) => {
    const match = line.match(/^([a-f0-9]{64}) {2}([^/\\]+)$/);
    if (!match) throw new Error(`Invalid checksum line '${line}'.`);
    return { digest: match[1], name: match[2] };
  });
  assertExactAssetNames(entries.map((entry) => entry.name), expectedNames);
  for (const entry of entries) {
    const actual = await sha256(join(root, entry.name));
    if (actual !== entry.digest) throw new Error(`SHA-256 mismatch for '${entry.name}'.`);
  }
  return entries;
}

function assertExactAssetNames(actualNames, expectedNames) {
  const actual = [...actualNames].sort();
  const expected = [...expectedNames].sort();
  if (new Set(actual).size !== actual.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Release asset set mismatch. Expected ${expected.join(", ")}; found ${actual.join(", ") || "none"}.`);
  }
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function collectFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
