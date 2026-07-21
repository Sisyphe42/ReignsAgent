import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validatePortableArchiveEntries } from "../../scripts/release-archive.mjs";

describe("portable release archive contracts", () => {
  it("accepts a legal Node release archive", () => {
    const prefix = "reigns-agent-0.1.0/";
    assert.doesNotThrow(() => validatePortableArchiveEntries([
      `${prefix}creator/index.html`,
      `${prefix}start.mjs`,
      `${prefix}LICENSE.reigns-agent.txt`,
      `${prefix}THIRD_PARTY_NOTICES.md`
    ], { kind: "node", version: "0.1.0" }));
  });

  it("rejects user data, secrets, source tests, and paths outside the release root", () => {
    const base = [
      "reigns-agent-0.1.0/creator/index.html",
      "reigns-agent-0.1.0/start.mjs",
      "reigns-agent-0.1.0/LICENSE.reigns-agent.txt",
      "reigns-agent-0.1.0/THIRD_PARTY_NOTICES.md"
    ];
    for (const forbidden of [
      "reigns-agent-0.1.0/ReignsAgentData/config.toml",
      "reigns-agent-0.1.0/.env.production",
      "reigns-agent-0.1.0/test/smoke.js",
      "outside.txt"
    ]) {
      assert.throws(() => validatePortableArchiveEntries([...base, forbidden], { kind: "node", version: "0.1.0" }));
    }
  });

  it("requires project legal files and the native desktop launcher", () => {
    const base = ["ReignsAgent-win32-x64/LICENSE.reigns-agent.txt", "ReignsAgent-win32-x64/THIRD_PARTY_NOTICES.md"];
    assert.doesNotThrow(() => validatePortableArchiveEntries([...base, "ReignsAgent-win32-x64/ReignsAgent.exe"], {
      kind: "desktop",
      platform: "win32"
    }));
    assert.throws(() => validatePortableArchiveEntries(base, { kind: "desktop", platform: "win32" }), /ReignsAgent\.exe/);
  });
});
