import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { WorkspaceError, createReleaseRecord, createWorkspaceStore } from "../src/index.js";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace storage", () => {
  it("creates config and a normal project, then restores both", async () => {
    const root = await temporaryRoot();
    const first = await createWorkspaceStore({ dataRoot: root, initialBundle: sampleBundle("Sample") });
    const [project] = await first.listProjects();
    assert.equal(project.title, "Sample");
    assert.equal(project.source, "sample");

    await first.updateConfig({ theme: "nocturne", ai: { endpoint: "https://example.test/v1", apiKey: "plain-secret" } });
    await first.updateWorkspaceState({ activePanel: "review", selectedCardId: "opening" });
    const bundle = await first.readActiveBundle();
    bundle.metadata.title = "Renamed";
    await first.saveActiveBundle(bundle);

    const second = await createWorkspaceStore({ dataRoot: root });
    assert.equal((await second.getConfig()).theme, "nocturne");
    assert.equal((await second.getConfig()).ai.hasApiKey, true);
    assert.equal(await second.getStoredApiKey(), "plain-secret");
    assert.equal((await second.listProjects())[0].title, "Renamed");
    assert.deepEqual(await second.getWorkspaceState(), {
      schemaVersion: 1,
      activePanel: "review",
      selectedCardId: "opening",
      previewSkin: ""
    });
    assert.doesNotMatch(JSON.stringify(await second.getConfig()), /plain-secret/);
    assert.match(await readFile(join(root, "config.toml"), "utf8"), /apiKey = "plain-secret"/);
  });

  it("creates, opens, and deletes isolated projects", async () => {
    const root = await temporaryRoot();
    const store = await createWorkspaceStore({ dataRoot: root, initialBundle: sampleBundle("First") });
    const first = (await store.listProjects())[0];
    const second = await store.createProject({ bundle: sampleBundle("Second"), source: "blank" });
    assert.notEqual(first.id, second.id);
    assert.equal((await store.readActiveBundle()).metadata.title, "Second");

    await store.openProject(first.id);
    assert.equal((await store.readActiveBundle()).metadata.title, "First");
    await store.deleteProject(first.id);
    assert.equal((await store.listProjects()).length, 1);
    assert.equal((await store.getConfig()).activeProjectId, second.id);
    await store.deleteProject(second.id);
    assert.equal((await store.listProjects()).length, 1);
    assert.equal((await store.readActiveBundle()).metadata.title, "Untitled");
  });

  it("serializes concurrent writes in invocation order without temporary files", async () => {
    const root = await temporaryRoot();
    const store = await createWorkspaceStore({ dataRoot: root });
    const base = await store.readActiveBundle();
    const writes = ["One", "Two", "Three"].map((title) => store.saveActiveBundle({
      ...base,
      metadata: { ...base.metadata, title }
    }));
    await Promise.all(writes);
    assert.equal((await store.readActiveBundle()).metadata.title, "Three");
    const projectRoot = join(root, "projects", (await store.getConfig()).activeProjectId);
    const files = await import("node:fs/promises").then(({ readdir }) => readdir(projectRoot));
    assert.equal(files.some((file) => file.endsWith(".tmp")), false);
  });

  it("persists project-scoped release history and safely resolves artifacts", async () => {
    const root = await temporaryRoot();
    const store = await createWorkspaceStore({ dataRoot: root, initialBundle: sampleBundle("Release One") });
    const firstProject = await store.getActiveProject();
    await mkdir(join(root, "projects", firstProject.id, "assets", "art"), { recursive: true });
    await writeFile(join(root, "projects", firstProject.id, "assets", "art", "card.png"), "project-art");
    assert.equal((await store.readActiveProjectAsset("assets/art/card.png")).toString(), "project-art");
    assert.equal(await store.readActiveProjectAsset("assets/art/missing.png"), null);
    await assert.rejects(() => store.readActiveProjectAsset("assets/../content.json"), { code: "project_asset_path_invalid" });
    const firstOutput = await store.getReleaseOutput({ fileName: "release-one-1.0.0-build.exe" });
    await mkdir(join(root, "Builds", firstProject.id), { recursive: true });
    await writeFile(firstOutput.artifactPath, "MZ-first");
    const firstRecord = createReleaseRecord({
      projectId: firstProject.id,
      build: { buildId: "build-one", title: "Release One", version: "1.0.0" },
      artifactRelativePath: firstOutput.artifactRelativePath,
      size: 8,
      sha256: createHash("sha256").update("MZ-first").digest("hex")
    });
    await store.saveRelease(firstRecord);
    assert.deepEqual((await store.listReleases()).map((release) => release.id), [firstRecord.id]);
    assert.equal((await store.resolveReleaseArtifact(firstRecord.id)).artifactPath, firstOutput.artifactPath);

    const secondProject = await store.createProject({ bundle: sampleBundle("Release Two") });
    assert.deepEqual(await store.listReleases(), []);
    await assert.rejects(() => store.resolveReleaseArtifact(firstRecord.id), { code: "release_not_found" });

    await store.openProject(firstProject.id);
    await store.deleteRelease(firstRecord.id);
    assert.deepEqual(await store.listReleases(), []);
    await assert.rejects(() => readFile(firstOutput.artifactPath), { code: "ENOENT" });
    assert.notEqual(secondProject.id, firstProject.id);
  });

  it("rejects release paths outside the active project output", async () => {
    const root = await temporaryRoot();
    const store = await createWorkspaceStore({ dataRoot: root });
    const project = await store.getActiveProject();
    const record = createReleaseRecord({
      projectId: project.id,
      build: { buildId: "build-one", title: "Release", version: "1.0.0" },
      artifactRelativePath: `another-project/release.exe`,
      size: 1,
      sha256: "b".repeat(64)
    });
    await assert.rejects(() => store.saveRelease(record), { code: "release_project_mismatch" });
    await assert.rejects(() => store.getReleaseOutput({ fileName: "../escape.exe" }), { code: "release_file_name_invalid" });
  });

  it("rejects malformed TOML without replacing it", async () => {
    const root = await temporaryRoot();
    await createWorkspaceStore({ dataRoot: root });
    await writeFile(join(root, "config.toml"), "not = [valid", "utf8");
    await assert.rejects(() => createWorkspaceStore({ dataRoot: root }), (error) => {
      assert.ok(error instanceof WorkspaceError);
      assert.equal(error.code, "toml_parse_failed");
      return true;
    });
    assert.equal(await readFile(join(root, "config.toml"), "utf8"), "not = [valid");
  });
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "reigns-workspace-"));
  roots.push(root);
  return root;
}

function sampleBundle(title) {
  return {
    schemaVersion: 1,
    metadata: { title },
    cards: [{
      id: "opening",
      text: "A petition arrives.",
      choices: [
        { id: "left", label: "Hear it", effects: {} },
        { id: "right", label: "Refuse", effects: {} }
      ]
    }],
    assets: []
  };
}
