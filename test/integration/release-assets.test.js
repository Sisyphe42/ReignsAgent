import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { zipSync } from "fflate";

import { assembleReleaseAssets, expectedReleaseAssets, verifyReleaseChecksums } from "../../scripts/release-assets.mjs";

describe("release asset assembly", () => {
  it("requires five verified ZIPs and writes sorted, verifiable checksums", async () => {
    const root = await mkdtemp(join(tmpdir(), "reigns-release-assets-"));
    try {
      const input = join(root, "input");
      const output = join(root, "output");
      await mkdir(input);
      await writeFixtureArchives(input, "0.1.0");
      const result = await assembleReleaseAssets({ inputRoot: input, outputRoot: output, version: "0.1.0" });
      assert.deepEqual(result.assets, expectedReleaseAssets("0.1.0").map((asset) => asset.name).sort());
      const checksumText = await readFile(result.checksumPath, "utf8");
      const checksumNames = checksumText.trim().split("\n").map((line) => line.slice(66));
      assert.deepEqual(checksumNames, [...checksumNames].sort((left, right) => left.localeCompare(right)));
      await verifyReleaseChecksums({ root: output, expectedNames: result.assets });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects incomplete sets and checksum corruption", async () => {
    const root = await mkdtemp(join(tmpdir(), "reigns-release-assets-invalid-"));
    try {
      const input = join(root, "input");
      const output = join(root, "output");
      await mkdir(input);
      await writeFixtureArchives(input, "0.1.0");
      await rm(join(input, "ReignsAgent-linux-x64-0.1.0.zip"));
      await assert.rejects(() => assembleReleaseAssets({ inputRoot: input, outputRoot: output, version: "0.1.0" }), /asset set mismatch/);

      await writeFixtureArchives(input, "0.1.0");
      const result = await assembleReleaseAssets({ inputRoot: input, outputRoot: output, version: "0.1.0" });
      await writeFile(join(output, result.assets[0]), "corrupted");
      await assert.rejects(() => verifyReleaseChecksums({ root: output, expectedNames: result.assets }), /SHA-256 mismatch/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writeFixtureArchives(root, version) {
  for (const asset of expectedReleaseAssets(version)) {
    const prefix = asset.kind === "node" ? `reigns-agent-${version}` : asset.name.replace(`-${version}.zip`, "");
    const entries = asset.kind === "node" ? {
      [`${prefix}/creator/index.html`]: bytes("creator"),
      [`${prefix}/start.mjs`]: bytes("start"),
      [`${prefix}/LICENSE.reigns-agent.txt`]: bytes("license"),
      [`${prefix}/THIRD_PARTY_NOTICES.md`]: bytes("notices")
    } : {
      [`${prefix}/LICENSE.reigns-agent.txt`]: bytes("license"),
      [`${prefix}/THIRD_PARTY_NOTICES.md`]: bytes("notices"),
      [desktopMarker(prefix, asset.platform)]: bytes("executable")
    };
    await writeFile(join(root, asset.name), zipSync(entries));
  }
}

function desktopMarker(prefix, platform) {
  if (platform === "win32") return `${prefix}/ReignsAgent.exe`;
  if (platform === "darwin") return `${prefix}/ReignsAgent.app/Contents/MacOS/ReignsAgent`;
  return `${prefix}/ReignsAgent`;
}

function bytes(value) {
  return new TextEncoder().encode(value);
}
