import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { unzipSync } from "fflate";

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("creator release distribution", () => {
  it("builds a minimal ZIP with cross-platform launchers and no development-only paths", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "reigns-agent-release-"));
    try {
      await ensureCreatorBuild();
      await execFileAsync(process.execPath, ["scripts/build-release.mjs", "--output", tempRoot], { cwd: ROOT });

      const archivePath = join(tempRoot, "reigns-agent-0.1.0.zip");
      const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
      const names = Object.keys(archive).sort();

      assert.ok(names.includes("reigns-agent-0.1.0/creator/index.html"));
      assert.ok(names.includes("reigns-agent-0.1.0/start.mjs"));
      assert.ok(names.includes("reigns-agent-0.1.0/start.cmd"));
      assert.ok(names.includes("reigns-agent-0.1.0/start.sh"));
      assert.ok(names.includes("reigns-agent-0.1.0/scripts/build-game.mjs"));
      assert.ok(names.includes("reigns-agent-0.1.0/packages/interface/web/player.html"));
      assert.equal(names.some(isForbiddenReleasePath), false);

      const shellLauncher = new TextDecoder().decode(archive["reigns-agent-0.1.0/start.sh"]);
      const windowsLauncher = new TextDecoder().decode(archive["reigns-agent-0.1.0/start.cmd"]);
      assert.match(shellLauncher, /exec node/);
      assert.match(shellLauncher, /"\$@"/);
      assert.match(windowsLauncher, /node .*start\.mjs.*%\*/i);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs Creator, API, player preview, import, and player build after ZIP extraction", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "reigns-agent-release-smoke-"));
    let server;
    try {
      await ensureCreatorBuild();
      await execFileAsync(process.execPath, ["scripts/build-release.mjs", "--output", tempRoot], { cwd: ROOT });
      const extractRoot = join(tempRoot, "extracted");
      await extractZip(join(tempRoot, "reigns-agent-0.1.0.zip"), extractRoot);
      const releaseRoot = join(extractRoot, "reigns-agent-0.1.0");

      server = spawn(process.execPath, ["start.mjs", "--no-open"], {
        cwd: releaseRoot,
        env: { ...process.env, HOST: "127.0.0.1", PORT: "0" },
        stdio: ["ignore", "pipe", "pipe"]
      });
      const output = await waitForOutput(server, /ReignsAgent: http:\/\/127\.0\.0\.1:(\d+)\/workbench/);
      const port = Number(output.match(/ReignsAgent: http:\/\/127\.0\.0\.1:(\d+)\/workbench/)[1]);
      const baseUrl = `http://127.0.0.1:${port}`;

      const [workbench, play, editor] = await Promise.all([
        fetch(`${baseUrl}/workbench`),
        fetch(`${baseUrl}/play`),
        fetch(`${baseUrl}/api/editor`)
      ]);
      assert.equal(workbench.status, 200);
      const workbenchHtml = await workbench.text();
      assert.match(workbenchHtml, /<div id="root"><\/div>/);
      const creatorAssetPath = workbenchHtml.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
      assert.ok(creatorAssetPath);
      assert.equal((await fetch(`${baseUrl}${creatorAssetPath}`)).status, 200);
      assert.equal(play.status, 200);
      assert.match(await play.text(), /ReignsAgent/);
      assert.equal((await fetch(`${baseUrl}/assets/dashboard.css`)).status, 200);
      assert.equal(editor.status, 200);
      assert.equal((await editor.json()).cards.length > 0, true);

      const sample = JSON.parse(await readFile(join(releaseRoot, "fixtures/content/minimal.cards.json"), "utf8"));
      const imported = await fetch(`${baseUrl}/api/editor/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundle: sample })
      });
      assert.equal(imported.status, 200);
      assert.equal((await imported.json()).imported, true);

      const edited = await fetch(`${baseUrl}/api/editor/metadata`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metadata: { title: "Release smoke test" } })
      });
      assert.equal(edited.status, 200);
      assert.equal((await edited.json()).metadata.title, "Release smoke test");

      const playerOutput = join(tempRoot, "player-output");
      await execFileAsync(process.execPath, [
        "scripts/build-game.mjs",
        "fixtures/content/oss-court.cards.json",
        playerOutput
      ], { cwd: releaseRoot });
      assert.match(await readFile(join(playerOutput, "player.html"), "utf8"), /ReignsAgent/);
      assert.match(await readFile(join(playerOutput, "player-runtime.js"), "utf8"), /createCoreRuntime/);
    } finally {
      await stopChild(server);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

let creatorBuildPromise;
function ensureCreatorBuild() {
  creatorBuildPromise ??= execFileAsync(
    process.execPath,
    [join(ROOT, "node_modules/vite/bin/vite.js"), "build"],
    { cwd: join(ROOT, "apps/creator-web") }
  );
  return creatorBuildPromise;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
}

async function extractZip(archivePath, outputRoot) {
  const entries = unzipSync(new Uint8Array(await readFile(archivePath)));
  for (const [name, bytes] of Object.entries(entries)) {
    const outputPath = join(outputRoot, ...name.split("/"));
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);
  }
}

function isForbiddenReleasePath(name) {
  return name.includes("/.env")
    || name.includes("/node_modules/")
    || name.includes("/test/")
    || name.includes(".test.")
    || name.includes("/apps/creator-web/src/");
}

function waitForOutput(child, pattern) {
  return new Promise((resolveOutput, rejectOutput) => {
    let output = "";
    const timeout = setTimeout(() => {
      rejectOutput(new Error(`Timed out waiting for release server output. Received:\n${output}`));
    }, 10_000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (pattern.test(output)) {
        clearTimeout(timeout);
        resolveOutput(output);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectOutput(new Error(`Release server exited with code ${code}. Output:\n${output}`));
    });
  });
}
