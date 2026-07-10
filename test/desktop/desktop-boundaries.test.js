import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CREATOR_RUNTIME_ENTRIES } from "../../scripts/runtime-files.mjs";
import { desktopRuntimePaths } from "../../apps/desktop-electron/src/runtime-paths.mjs";
import { desktopBuildOutputDir, isAllowedAppUrl } from "../../apps/desktop-electron/src/security.mjs";
import { handleSquirrelStartup } from "../../apps/desktop-electron/src/squirrel-startup.mjs";

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

    const creatorSource = await readFile(join(ROOT, "apps/creator-web/src/main.jsx"), "utf8");
    assert.doesNotMatch(creatorSource, /from\s+["']electron(?:\/|["'])/);
    assert.doesNotMatch(creatorSource, /window\.reignsDesktop/);
  });

  it("handles Squirrel lifecycle events without a packaged node_modules dependency", async () => {
    const desktopPackage = JSON.parse(await readFile(join(ROOT, "apps/desktop-electron/package.json"), "utf8"));
    const mainSource = await readFile(join(ROOT, "apps/desktop-electron/src/main.mjs"), "utf8");
    const forgeConfig = await import("../../apps/desktop-electron/forge.config.mjs");
    assert.deepEqual(desktopPackage.dependencies, {});
    assert.equal(forgeConfig.default.packagerConfig.prune, false);
    assert.equal(forgeConfig.default.packagerConfig.asar.unpack, "**/server-child.mjs");
    assert.equal(forgeConfig.default.packagerConfig.asar.unpackDir, "runtime");
    assert.doesNotMatch(mainSource, /electron-squirrel-startup/);
    assert.match(mainSource, /!smokeTest && !app\.requestSingleInstanceLock\(\)/);

    const spawned = [];
    let quitCount = 0;
    const spawnProcess = (executable, args, options) => {
      const child = new EventEmitter();
      spawned.push({ executable, args, options, child });
      return child;
    };
    const handled = handleSquirrelStartup({
      platform: "win32",
      argv: ["ReignsAgent.exe", "--squirrel-install"],
      execPath: "C:\\Users\\creator\\AppData\\Local\\ReignsAgent\\app-0.1.1\\ReignsAgent.exe",
      quit: () => { quitCount += 1; },
      spawnProcess
    });

    assert.equal(handled, true);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].executable, "C:\\Users\\creator\\AppData\\Local\\ReignsAgent\\Update.exe");
    assert.deepEqual(spawned[0].args, ["--createShortcut=ReignsAgent.exe"]);
    assert.deepEqual(spawned[0].options, { detached: true });
    spawned[0].child.emit("close", 0);
    spawned[0].child.emit("error", new Error("ignored after close"));
    assert.equal(quitCount, 1);
  });
});
