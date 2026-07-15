#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { createCreatorServer } from "../apps/creator-server/src/server.mjs";

if (process.platform !== "win32" || process.arch !== "x64") {
  console.log(JSON.stringify({ skipped: true, reason: "Windows x64 is required" }));
  process.exit(0);
}

const execFileAsync = promisify(execFile);
const rootDir = fileURLToPath(new URL("..", import.meta.url));
const dataRoot = await mkdtemp(join(tmpdir(), "reigns-agent-player-smoke-"));
const playerHostPath = join(rootDir, "apps/player-windows/out/win-x64/ReignsAgentPlayer.exe");
const bundle = JSON.parse(await readFile(join(rootDir, "fixtures/content/oss-court.cards.json"), "utf8"));
const server = await createCreatorServer({
  rootDir,
  dataRoot,
  initialBundle: bundle,
  windowsPlayerHostPath: playerHostPath,
  enableWindowsRelease: true
});

try {
  const address = await server.start({ port: 0 });
  const response = await fetch(`${address.origin}/api/releases/windows-x64`, { method: "POST" });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const artifactPath = join(dataRoot, "Builds", ...body.release.artifactRelativePath.split("/"));
  const { stdout } = await execFileAsync(artifactPath, ["--smoke-test"], { timeout: 30_000 });
  assert.match(stdout, /ReignsAgent player smoke passed:/);
  assert.match(stdout, new RegExp(`cards=${bundle.cards.length}\\b`));
  assert.match(stdout, new RegExp(`title=${escapeRegExp(bundle.metadata.title)}`));
  console.log(JSON.stringify({ passed: true, artifactPath, output: stdout.trim() }, null, 2));
} finally {
  await server.close();
  await rm(dataRoot, { recursive: true, force: true });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
