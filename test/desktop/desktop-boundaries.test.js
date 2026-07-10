import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CREATOR_RUNTIME_ENTRIES } from "../../scripts/runtime-files.mjs";
import { desktopBuildOutputDir, isAllowedAppUrl } from "../../apps/desktop-electron/src/security.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("Electron desktop boundaries", () => {
  it("keeps navigation on the ephemeral Creator origin", () => {
    const origin = "http://127.0.0.1:43210";
    assert.equal(isAllowedAppUrl(`${origin}/workbench`, origin), true);
    assert.equal(isAllowedAppUrl(`${origin}/api/editor`, origin), true);
    assert.equal(isAllowedAppUrl("http://127.0.0.1:43211/workbench", origin), false);
    assert.equal(isAllowedAppUrl("https://example.com", origin), false);
    assert.equal(isAllowedAppUrl("not a URL", origin), false);
  });

  it("uses a user-writable desktop build directory", () => {
    assert.equal(
      desktopBuildOutputDir(join("home", "Documents")),
      join("home", "Documents", "ReignsAgent", "Builds")
    );
  });

  it("stages the same allowlisted runtime used by the Node ZIP", async () => {
    assert.deepEqual(CREATOR_RUNTIME_ENTRIES[0], ["apps/creator-web/dist", "creator"]);
    assert.equal(CREATOR_RUNTIME_ENTRIES.some(([source]) => source.includes("node_modules")), false);
    assert.equal(CREATOR_RUNTIME_ENTRIES.some(([source]) => source.includes("test")), false);

    const creatorSource = await readFile(join(ROOT, "apps/creator-web/src/main.jsx"), "utf8");
    assert.doesNotMatch(creatorSource, /from\s+["']electron(?:\/|["'])/);
    assert.doesNotMatch(creatorSource, /window\.reignsDesktop/);
  });
});
