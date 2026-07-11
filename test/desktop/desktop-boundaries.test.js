import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CREATOR_RUNTIME_ENTRIES } from "../../scripts/runtime-files.mjs";
import { desktopPortablePaths, desktopRuntimePaths } from "../../apps/desktop-electron/src/runtime-paths.mjs";
import { isAllowedAppUrl } from "../../apps/desktop-electron/src/security.mjs";

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

  it("keeps portable data beside the extracted application on every platform", () => {
    assert.deepEqual(desktopPortablePaths({
      appPath: join("repo", "apps", "desktop-electron"),
      execPath: join("tools", "electron"),
      isPackaged: false,
      platform: "win32"
    }), {
      dataRoot: join("repo", "apps", "desktop-electron", "ReignsAgentData"),
      sessionData: join("repo", "apps", "desktop-electron", "ReignsAgentData", "SessionData"),
      builds: join("repo", "apps", "desktop-electron", "ReignsAgentData", "Builds")
    });
    assert.equal(desktopPortablePaths({
      appPath: "ignored",
      execPath: join("portable", "ReignsAgent.exe"),
      isPackaged: true,
      platform: "win32"
    }).dataRoot, join("portable", "ReignsAgentData"));
    assert.equal(desktopPortablePaths({
      appPath: "ignored",
      execPath: join("portable", "ReignsAgent"),
      isPackaged: true,
      platform: "linux"
    }).dataRoot, join("portable", "ReignsAgentData"));
    assert.equal(desktopPortablePaths({
      appPath: "ignored",
      execPath: join("portable", "ReignsAgent.app", "Contents", "MacOS", "ReignsAgent"),
      isPackaged: true,
      platform: "darwin"
    }).dataRoot, resolve("portable", "ReignsAgentData"));
  });

  it("runs the utility process from unpacked production resources", () => {
    assert.deepEqual(desktopRuntimePaths(join("repo", "apps", "desktop-electron")), {
      childEntry: join("repo", "apps", "desktop-electron", "src/server-child.mjs"),
      runtimeRoot: join("repo", "apps", "desktop-electron", "runtime")
    });
    assert.deepEqual(desktopRuntimePaths(join("resources", "app.asar")), {
      childEntry: join("resources", "app.asar.unpacked", "src/server-child.mjs"),
      runtimeRoot: join("resources", "app.asar.unpacked", "runtime")
    });
  });

  it("stages the same allowlisted runtime used by the Node ZIP", async () => {
    assert.deepEqual(CREATOR_RUNTIME_ENTRIES[0], ["apps/creator-web/dist", "creator"]);
    assert.equal(CREATOR_RUNTIME_ENTRIES.some(([source]) => source.includes("node_modules")), false);
    assert.equal(CREATOR_RUNTIME_ENTRIES.some(([source]) => source.includes("test")), false);
    assert.equal(CREATOR_RUNTIME_ENTRIES.some(([source]) => source === "packages/workspace/src"), true);

    const creatorSource = await readFile(join(ROOT, "apps/creator-web/src/main.jsx"), "utf8");
    assert.doesNotMatch(creatorSource, /from\s+["']electron(?:\/|["'])/);
    assert.doesNotMatch(creatorSource, /window\.reignsDesktop/);
  });

  it("builds only portable ZIP artifacts with canonical product metadata", async () => {
    const desktopPackage = JSON.parse(await readFile(join(ROOT, "apps/desktop-electron/package.json"), "utf8"));
    const mainSource = await readFile(join(ROOT, "apps/desktop-electron/src/main.mjs"), "utf8");
    const forgeConfig = await import("../../apps/desktop-electron/forge.config.mjs");
    assert.deepEqual(desktopPackage.dependencies, {});
    assert.equal(desktopPackage.productName, "ReignsAgent");
    assert.equal(desktopPackage.author, "Sisyphe42");
    assert.equal(forgeConfig.default.packagerConfig.prune, false);
    assert.equal(forgeConfig.default.packagerConfig.asar.unpack, "**/server-child.mjs");
    assert.equal(forgeConfig.default.packagerConfig.asar.unpackDir, "runtime");
    assert.equal(forgeConfig.default.packagerConfig.win32metadata.CompanyName, "Sisyphe42");
    assert.equal(forgeConfig.default.packagerConfig.win32metadata.ProductName, "ReignsAgent");
    assert.deepEqual(forgeConfig.default.makers, []);
    assert.equal(Object.keys(desktopPackage.devDependencies).some((name) => name.includes("maker-")), false);
    assert.doesNotMatch(mainSource, /Squirrel|documents/);
    assert.match(mainSource, /!smokeTest && !app\.requestSingleInstanceLock\(\)/);
  });
});
