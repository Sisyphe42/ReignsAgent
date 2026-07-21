import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendWindowsReleasePayload,
  createWindowsReleasePayload,
  normalizeReleasePath,
  parseWindowsReleasePayload,
  sanitizeReleaseFilePart,
  sha256
} from "../src/windows-release.js";

const baseOptions = {
  projectId: "project-1",
  buildId: "build-abc",
  title: "Court",
  version: "1.2.3",
  files: {
    "player.html": "<html></html>",
    "player-runtime.js": "export {};",
    "build-abc.game.json": "{}"
  }
};

describe("Windows player release payload", () => {
  it("creates deterministic payloads with sorted, verified files", () => {
    const first = createWindowsReleasePayload(baseOptions);
    const second = createWindowsReleasePayload({ ...baseOptions, files: Object.fromEntries(Object.entries(baseOptions.files).reverse()) });
    assert.deepEqual(first.bytes, second.bytes);

    const host = Buffer.from("MZ-test-host");
    const release = appendWindowsReleasePayload(host, baseOptions);
    const parsed = parseWindowsReleasePayload(release.executable);
    assert.equal(parsed.payloadStart, host.length);
    assert.equal(parsed.manifest.projectId, "project-1");
    assert.equal(parsed.manifest.entry, "player.html");
    assert.equal(parsed.files.get("player-runtime.js").toString("utf8"), "export {};");
  });

  it("rejects unsafe and duplicate paths", () => {
    for (const path of ["../player.html", "/player.html", "assets\\logo.png", "assets//logo.png", "C:/player.html", "./player.html", "assets/CON", "assets/card. ", "assets/bad?.png"]) {
      assert.throws(() => normalizeReleasePath(path), { code: "release_path_invalid" });
    }
    assert.throws(() => createWindowsReleasePayload({
      ...baseOptions,
      files: [["player.html", "one"], ["player.html", "two"]]
    }), { code: "release_file_duplicate" });
  });

  it("rejects damaged footers, manifests, and file data", () => {
    const release = appendWindowsReleasePayload(Buffer.from("MZ-host"), baseOptions).executable;
    const badFooter = Buffer.from(release);
    badFooter[badFooter.length - 72] ^= 0xff;
    assert.throws(() => parseWindowsReleasePayload(badFooter), { code: "release_footer_invalid" });

    const badPayload = Buffer.from(release);
    badPayload[10] ^= 0xff;
    assert.throws(() => parseWindowsReleasePayload(badPayload), { code: "release_hash_mismatch" });

    const truncated = release.subarray(0, release.length - 10);
    assert.throws(() => parseWindowsReleasePayload(truncated));

    const badFileHash = Buffer.from(release);
    const footerStart = badFileHash.length - 72;
    const manifestLength = Number(badFileHash.readBigUInt64LE(footerStart + 20));
    const filesLength = Number(badFileHash.readBigUInt64LE(footerStart + 28));
    const payloadStart = footerStart - manifestLength - filesLength;
    const manifest = JSON.parse(badFileHash.subarray(payloadStart, payloadStart + manifestLength).toString("utf8"));
    manifest.files[0].sha256 = "0".repeat(64);
    const replacedManifest = Buffer.from(JSON.stringify(manifest), "utf8");
    assert.equal(replacedManifest.length, manifestLength);
    replacedManifest.copy(badFileHash, payloadStart);
    Buffer.from(sha256(badFileHash.subarray(payloadStart, footerStart)), "hex").copy(badFileHash, footerStart + 36);
    assert.throws(() => parseWindowsReleasePayload(badFileHash), { code: "release_file_hash_mismatch" });
  });

  it("sanitizes Windows file-name parts and produces SHA-256", () => {
    assert.equal(sanitizeReleaseFilePart(" My: Court / 你好 "), "My-Court");
    assert.equal(sanitizeReleaseFilePart("..."), "untitled");
    assert.equal(sha256("test"), "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
  });
});
