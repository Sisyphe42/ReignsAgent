import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CREATOR_OPTIONAL_RUNTIME_ENTRIES, CREATOR_RUNTIME_ENTRIES } from "../../scripts/runtime-files.mjs";
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
    assert.equal(CREATOR_OPTIONAL_RUNTIME_ENTRIES.some(([source]) => source.endsWith("ReignsAgentPlayer.exe")), true);

    const creatorSource = await readFile(join(ROOT, "apps/creator-web/src/main.jsx"), "utf8");
    assert.doesNotMatch(creatorSource, /from\s+["']electron(?:\/|["'])/);
    assert.doesNotMatch(creatorSource, /window\.reignsDesktop/);
  });

  it("builds only portable ZIP artifacts with canonical product metadata", async () => {
    const desktopPackage = JSON.parse(await readFile(join(ROOT, "apps/desktop-electron/package.json"), "utf8"));
    const mainSource = await readFile(join(ROOT, "apps/desktop-electron/src/main.mjs"), "utf8");
    const playerSource = await readFile(join(ROOT, "packages/interface/web/player.html"), "utf8");
    const packagerConfig = await import("../../apps/desktop-electron/packager.config.mjs");
    assert.deepEqual(desktopPackage.dependencies, {});
    assert.equal(desktopPackage.productName, "ReignsAgent");
    assert.equal(desktopPackage.version, "0.1.0");
    assert.equal(desktopPackage.author, "Sisyphe42");
    assert.equal(packagerConfig.default.prune, false);
    assert.equal(packagerConfig.default.asar.unpack, "**/server-child.mjs");
    assert.equal(packagerConfig.default.asar.unpackDir, "runtime");
    assert.equal(packagerConfig.default.win32metadata.CompanyName, "Sisyphe42");
    assert.equal(packagerConfig.default.win32metadata.ProductName, "ReignsAgent");
    assert.match(mainSource, /\/workbench\?client=desktop/);
    assert.match(playerSource, /backUrl\.searchParams\.set\("client", requestedClient\)/);
    assert.match(playerSource, /backUrl\.searchParams\.set\("locale", requestedLocale\)/);
    assert.equal(Object.keys(desktopPackage.devDependencies).some((name) => name.includes("forge") || name.includes("maker-")), false);
    assert.doesNotMatch(mainSource, /Squirrel|documents/);
    assert.match(mainSource, /!smokeTest && !app\.requestSingleInstanceLock\(\)/);
    const portableBuilder = await readFile(join(ROOT, "scripts/build-portable-desktop.mjs"), "utf8");
    assert.match(portableBuilder, /LICENSE\.reigns-agent\.txt/);
    assert.match(portableBuilder, /THIRD_PARTY_NOTICES\.md/);
  });

  it("keeps the Windows release player DPI-correct and distinct from Creator preview", async () => {
    const nativeSource = await readFile(join(ROOT, "apps/player-windows/src/main.cpp"), "utf8");
    const manifest = await readFile(join(ROOT, "apps/player-windows/src/player.manifest"), "utf8");
    const standalonePlayer = await readFile(join(ROOT, "packages/interface/web/standalone-player.html"), "utf8");
    const creatorSource = await readFile(join(ROOT, "apps/creator-web/src/main.jsx"), "utf8");
    const skinCatalog = await readFile(join(ROOT, "packages/interface/web/skin-catalog.js"), "utf8");
    const windowsReleaseSource = await readFile(join(ROOT, "apps/creator-server/src/windows-release.mjs"), "utf8");

    assert.match(nativeSource, /SetProcessDpiAwarenessContext\(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2\)/);
    assert.match(nativeSource, /message == WM_DPICHANGED/);
    assert.match(manifest, /PerMonitorV2,PerMonitor/);
    assert.match(standalonePlayer, /class="decision-stage"/);
    assert.match(standalonePlayer, /element\.animate\(keyframes, options\)/);
    assert.match(standalonePlayer, /el\("left"\)\.addEventListener\("click"/);
    assert.match(standalonePlayer, /el\("restart"\)\.addEventListener\("click", restartReign\)/);
    assert.match(standalonePlayer, /reigns-agent\.player\.skin\.v1/);
    assert.match(standalonePlayer, /reigns-agent\.player\.motion\.v1/);
    assert.match(standalonePlayer, /from "\.\/skin-catalog\.js"/);
    assert.match(creatorSource, /from "\.\.\/\.\.\/\.\.\/packages\/interface\/web\/skin-catalog\.js"/);
    assert.match(creatorSource, /applySkinTheme\(document\.documentElement, skin\)/);
    assert.match(skinCatalog, /export const SKINS = Object\.freeze/);
    assert.match(windowsReleaseSource, /previousArtifact\?\.equals\(executable\)/);
    assert.doesNotMatch(windowsReleaseSource, /subarray\(0, hostBytes\.length\).*return existing/s);
    assert.match(standalonePlayer, /safeStorageGet\(SKIN_PERSIST_KEY\)/);
    assert.match(standalonePlayer, /reigns-agent\.player\.history\.v1:/);
    assert.match(standalonePlayer, /decisionHistory = decisionHistory\.slice\(-MAX_HISTORY\)/);
    assert.match(standalonePlayer, /const snapshot = player\.swipe\(direction\);\s+recordDecision\(before, snapshot, direction\)/);
    assert.match(standalonePlayer, /await animateOutgoing\(direction\)/);
    assert.match(standalonePlayer, /await animateIncoming\(direction\)/);
    assert.match(standalonePlayer, /currentMotion === "reduced"/);
    assert.doesNotMatch(standalonePlayer, /matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)/);
    assert.match(standalonePlayer, /new Set\(decisionHistory\.map\(\(record\) => record\.reign\)\)/);
    assert.match(standalonePlayer, /player\.setLocale\(locale\)/);
    assert.match(standalonePlayer, /id="about-project-description"/);
    assert.match(standalonePlayer, /href="https:\/\/github\.com\/Sisyphe42\/ReignsAgent"/);
    assert.match(standalonePlayer, /\["http:", "https:"\]\.includes\(url\.protocol\)/);
    assert.doesNotMatch(standalonePlayer, /open-source authoring framework|Creator tools, AI connectors/);
    assert.match(nativeSource, /IsExternalHttpUrl\(uri\).*ShellExecuteW/s);
    assert.match(creatorSource, /id="project-title-url"/);
    assert.match(creatorSource, /id="project-author-url"/);
    assert.match(creatorSource, /normalizeOptionalExternalUrl\(titleUrl\)/);
    assert.match(standalonePlayer, /data-skin="famicom".*\.card/s);
    assert.match(standalonePlayer, /data-skin="phantom".*\.card/s);
    assert.match(standalonePlayer, /--raised-ink: #121214; --raised-muted: #5f584f/);
    assert.match(standalonePlayer, /\.skin-option__description[^}]+color: var\(--raised-muted\)/);
    assert.match(standalonePlayer, /\.motion-option[^}]+color: var\(--raised-ink\)/);
    assert.match(standalonePlayer, /prefers-reduced-motion: reduce/);
    assert.doesNotMatch(standalonePlayer, /awaitingRestartConfirm|Click restart again/);
  });
});
