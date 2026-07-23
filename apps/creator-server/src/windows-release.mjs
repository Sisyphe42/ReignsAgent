import { readFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { prepareGameBuild, serializeBuild, stitchPlayerRuntime } from "../../../packages/interface/src/index.js";
import {
  appendWindowsReleasePayload,
  sanitizeReleaseFilePart,
  sha256
} from "../../../packages/interface/src/windows-release.js";
import { createReleaseRecord } from "../../../packages/workspace/src/index.js";

let temporarySequence = 0;

export async function buildWindowsPlayerRelease({ editor, interfaceWebRoot, coreSourcePath, playerHostPath, workspace }) {
  const project = await workspace.getActiveProject();
  const build = prepareGameBuild({ editor });
  const hostBytes = await readFile(playerHostPath).catch((error) => {
    const wrapped = new Error(`Windows player host is unavailable: ${error.message}`);
    wrapped.code = "windows_release_host_unavailable";
    throw wrapped;
  });
  const existing = (await workspace.listReleases()).find((release) => release.buildId === build.buildId);
  let previousArtifact = null;
  if (existing) {
    const { artifactPath } = await workspace.resolveReleaseArtifact(existing.id);
    previousArtifact = await readFile(artifactPath);
  }
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const releaseBuild = { ...build, createdAt };
  const files = await assembleWindowsPlayerFiles({ build: releaseBuild, interfaceWebRoot, coreSourcePath, workspace });
  const { executable } = appendWindowsReleasePayload(hostBytes, {
    projectId: project.id,
    buildId: build.buildId,
    title: build.title,
    version: build.version,
    files
  });
  if (existing && previousArtifact?.equals(executable)) return existing;
  const fileName = [
    sanitizeReleaseFilePart(build.title),
    sanitizeReleaseFilePart(build.version, "0.0.0"),
    sanitizeReleaseFilePart(build.buildId, "build")
  ].join("-") + ".exe";
  const output = await workspace.getReleaseOutput({ fileName });
  await writeBinaryAtomic(output.artifactPath, executable);
  const nextRecord = createReleaseRecord({
    projectId: project.id,
    build,
    artifactRelativePath: output.artifactRelativePath,
    size: executable.length,
    sha256: sha256(executable),
    createdAt
  });
  const record = existing ? { ...nextRecord, id: existing.id } : nextRecord;
  try {
    await workspace.saveRelease(record);
  } catch (error) {
    if (previousArtifact) await writeBinaryAtomic(output.artifactPath, previousArtifact).catch(() => {});
    else await rm(output.artifactPath, { force: true }).catch(() => {});
    throw error;
  }
  return record;
}

export async function assembleWindowsPlayerFiles({ build, interfaceWebRoot, coreSourcePath, workspace = null }) {
  const playerHtml = await readFile(resolve(interfaceWebRoot, "standalone-player.html"), "utf8");
  const playerRuntimeTemplate = await readFile(resolve(interfaceWebRoot, "player-runtime.js"), "utf8");
  const coreSource = await readFile(coreSourcePath, "utf8");
  const runtime = stitchPlayerRuntime(playerRuntimeTemplate, coreSource);
  const files = new Map([
    ["player.html", playerHtml],
    ["player-runtime.js", runtime],
    ["skin-catalog.js", await readFile(resolve(interfaceWebRoot, "skin-catalog.js"))],
    ["assets/card-artwork.js", await readFile(resolve(interfaceWebRoot, "assets/card-artwork.js"))],
    ["game.game.json", serializeBuild(build)]
  ]);
  const logoPath = resolve(interfaceWebRoot, "assets/logo-alpha.png");
  assertWithin(interfaceWebRoot, logoPath, "Player logo");
  files.set("assets/logo-alpha.png", await readFile(logoPath));

  const seen = new Set();
  for (const asset of build.content?.assets ?? []) {
    const uri = typeof asset?.uri === "string" ? asset.uri.replace(/^\.?\//, "") : "";
    if (!uri.startsWith("assets/") || uri.includes("..") || uri.includes("\\") || seen.has(uri)) continue;
    seen.add(uri);
    const source = resolve(interfaceWebRoot, ...uri.split("/"));
    assertWithin(interfaceWebRoot, source, `Player asset '${uri}'`);
    const projectAsset = workspace ? await workspace.readActiveProjectAsset(uri) : null;
    files.set(uri, projectAsset ?? await readFile(source));
  }
  return files;
}

export async function windowsReleaseCapability({ enabled, playerHostPath }) {
  if (!enabled) return { windowsX64: false, reason: "windows_host_required" };
  try {
    if (!(await stat(playerHostPath)).isFile()) throw new Error("not a file");
    return { windowsX64: true, reason: null };
  } catch {
    return { windowsX64: false, reason: "player_host_missing" };
  }
}

async function writeBinaryAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  temporarySequence += 1;
  const temporaryPath = `${path}.${process.pid}.${temporarySequence}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, { mode: 0o700 });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function assertWithin(root, target, label) {
  const path = relative(resolve(root), resolve(target));
  if (path.startsWith("..") || path === "" || resolve(target).includes("\0")) {
    const error = new Error(`${label} escapes the player asset root`);
    error.code = "release_asset_path_invalid";
    throw error;
  }
}
