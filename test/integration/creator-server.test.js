import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createCreatorServer } from "../../apps/creator-server/src/server.mjs";
import { parseWindowsReleasePayload } from "../../packages/interface/src/windows-release.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("Creator Server factory", () => {
  it("creates isolated instances with random ports and idempotent shutdown", async () => {
    const bundle = JSON.parse(await readFile(join(ROOT, "fixtures/content/oss-court.cards.json"), "utf8"));
    const outputRoot = await mkdtemp(join(tmpdir(), "reigns-agent-server-"));
    const first = await createCreatorServer({ rootDir: ROOT, initialBundle: bundle, defaultBuildOutputDir: outputRoot });
    const second = await createCreatorServer({ rootDir: ROOT, initialBundle: bundle });

    try {
      const [firstAddress, secondAddress] = await Promise.all([
        first.start({ port: 0 }),
        second.start({ port: 0 })
      ]);
      assert.notEqual(firstAddress.port, secondAddress.port);
      assert.match(firstAddress.origin, /^http:\/\/127\.0\.0\.1:\d+$/);

      const edited = await request(firstAddress.origin, "/api/editor/metadata", {
        method: "PATCH",
        body: { metadata: { title: "First instance" } }
      });
      assert.equal(edited.metadata.title, "First instance");

      const untouched = await request(secondAddress.origin, "/api/editor");
      assert.notEqual(untouched.metadata.title, "First instance");

      const exported = await request(firstAddress.origin, "/api/build/export", {
        method: "POST",
        body: { buildId: "factory-smoke" }
      });
      assert.equal(exported.exported, true);
      assert.equal(exported.outputPath, join(outputRoot, "factory-smoke.game.json"));
      assert.equal(JSON.parse(await readFile(exported.outputPath, "utf8")).buildId, "factory-smoke");
    } finally {
      await Promise.all([first.close(), second.close()]);
      await Promise.all([first.close(), second.close()]);
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("persists config, projects, editor content, and workspace state across restarts", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "reigns-agent-data-"));
    const bundle = JSON.parse(await readFile(join(ROOT, "fixtures/content/minimal.cards.json"), "utf8"));
    let server = await createCreatorServer({ rootDir: ROOT, dataRoot, initialBundle: bundle });
    try {
      let address = await server.start({ port: 0 });
      const initialProjects = await request(address.origin, "/api/projects");
      assert.equal(initialProjects.projects.length, 1);
      const originalId = initialProjects.projects[0].id;

      const config = await request(address.origin, "/api/config", {
        method: "PATCH",
        body: {
          theme: "phantom",
          aiAssistEnabled: true,
          ai: { endpoint: "https://ai.example.test/v1", modelId: "example-model", apiKey: "stored-secret" }
        }
      });
      assert.equal(config.theme, "phantom");
      assert.equal(config.ai.hasApiKey, true);
      assert.doesNotMatch(JSON.stringify(config), /stored-secret/);

      await request(address.origin, "/api/workspace", {
        method: "PATCH",
        body: { activePanel: "review", selectedCardId: "minimal-card" }
      });
      await request(address.origin, "/api/editor/metadata", {
        method: "PATCH",
        body: { metadata: { title: "Persistent project", author: "Court Author", description: "A portable court." } }
      });
      const created = await request(address.origin, "/api/projects", {
        method: "POST",
        body: { source: "sample" }
      });
      assert.equal(created.projects.length, 2);
      await request(address.origin, `/api/projects/${originalId}/open`, { method: "POST", body: {} });
      await server.close();

      server = await createCreatorServer({ rootDir: ROOT, dataRoot });
      address = await server.start({ port: 0 });
      const restoredEditor = await request(address.origin, "/api/editor");
      assert.equal(restoredEditor.metadata.title, "Persistent project");
      assert.equal(restoredEditor.metadata.author, "Court Author");
      assert.equal(restoredEditor.metadata.description, "A portable court.");
      assert.equal((await request(address.origin, "/api/config")).theme, "phantom");
      assert.equal((await request(address.origin, "/api/config")).ai.hasApiKey, true);
      assert.equal((await request(address.origin, "/api/projects")).projects.length, 2);
      assert.equal((await request(address.origin, "/api/workspace")).activePanel, "review");
      assert.match(await readFile(join(dataRoot, "config.toml"), "utf8"), /apiKey = "stored-secret"/);
    } finally {
      await server.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it("builds, restores, downloads, isolates, and deletes Windows project releases", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "reigns-agent-release-api-"));
    const playerHostPath = join(dataRoot, "test-player-host.exe");
    await writeFile(playerHostPath, "MZ-test-player-host");
    const bundle = JSON.parse(await readFile(join(ROOT, "fixtures/content/oss-court.cards.json"), "utf8"));
    let server = await createCreatorServer({
      rootDir: ROOT,
      dataRoot,
      initialBundle: bundle,
      windowsPlayerHostPath: playerHostPath,
      enableWindowsRelease: true
    });
    try {
      let address = await server.start({ port: 0 });
      const initial = await request(address.origin, "/api/releases");
      assert.equal(initial.capability.windowsX64, true);
      assert.deepEqual(initial.releases, []);

      const result = await request(address.origin, "/api/releases/windows-x64", { method: "POST", body: {} });
      assert.equal(result.released, true);
      assert.equal(result.release.target, "windows-x64");
      const repeated = await request(address.origin, "/api/releases/windows-x64", { method: "POST", body: {} });
      assert.equal(repeated.release.id, result.release.id);
      assert.equal((await request(address.origin, "/api/releases")).releases.length, 1);
      const artifactPath = join(dataRoot, "Builds", ...result.release.artifactRelativePath.split("/"));
      await writeFile(playerHostPath, "MZ-updated-player-host");
      const rebuilt = await request(address.origin, "/api/releases/windows-x64", { method: "POST", body: {} });
      assert.equal(rebuilt.release.id, result.release.id);
      assert.equal((await request(address.origin, "/api/releases")).releases.length, 1);
      assert.equal((await readFile(artifactPath)).subarray(0, "MZ-updated-player-host".length).toString(), "MZ-updated-player-host");
      const parsed = parseWindowsReleasePayload(await readFile(artifactPath));
      assert.equal(parsed.manifest.projectId, result.release.projectId);
      assert.equal(parsed.files.has("game.game.json"), true);
      assert.equal(parsed.files.has("skin-catalog.js"), true);
      assert.match(parsed.files.get("player.html").toString("utf8"), /from "\.\/skin-catalog\.js"/);
      assert.doesNotMatch(parsed.files.get("game.game.json").toString("utf8"), /apiKey|credentials/);

      const download = await fetch(`${address.origin}/api/releases/${result.release.id}/artifact`);
      assert.equal(download.status, 200);
      assert.match(download.headers.get("content-disposition"), /attachment/);
      assert.equal(Buffer.from(await download.arrayBuffer()).equals(await readFile(artifactPath)), true);

      const project = await request(address.origin, "/api/projects", { method: "POST", body: { source: "blank" } });
      assert.equal((await request(address.origin, "/api/releases")).releases.length, 0);
      await request(address.origin, `/api/projects/${result.release.projectId}/open`, { method: "POST", body: {} });
      assert.equal((await request(address.origin, "/api/releases")).releases.length, 1);
      assert.notEqual(project.project.id, result.release.projectId);

      await server.close();
      server = await createCreatorServer({
        rootDir: ROOT,
        dataRoot,
        windowsPlayerHostPath: playerHostPath,
        enableWindowsRelease: true
      });
      address = await server.start({ port: 0 });
      assert.equal((await request(address.origin, "/api/releases")).releases[0].id, result.release.id);
      await request(address.origin, `/api/releases/${result.release.id}`, { method: "DELETE" });
      assert.deepEqual((await request(address.origin, "/api/releases")).releases, []);
      await assert.rejects(() => readFile(artifactPath), { code: "ENOENT" });
    } finally {
      await server.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it("does not record a Windows release when player validation fails", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "reigns-agent-release-failure-"));
    const playerHostPath = join(dataRoot, "test-player-host.exe");
    await writeFile(playerHostPath, "MZ-test-player-host");
    const bundle = JSON.parse(await readFile(join(ROOT, "fixtures/content/minimal.cards.json"), "utf8"));
    const server = await createCreatorServer({
      rootDir: ROOT,
      dataRoot,
      initialBundle: bundle,
      windowsPlayerHostPath: playerHostPath,
      enableWindowsRelease: true
    });
    try {
      const address = await server.start({ port: 0 });
      const response = await fetch(`${address.origin}/api/releases/windows-x64`, { method: "POST" });
      assert.equal(response.status, 500);
      assert.deepEqual((await request(address.origin, "/api/releases")).releases, []);
    } finally {
      await server.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});

async function request(origin, path, { method = "GET", body } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}
