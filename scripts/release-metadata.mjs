import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export async function readReleaseMetadata(rootDir) {
  const rootPackage = await readJson(join(rootDir, "package.json"));
  const lockfile = await readJson(join(rootDir, "package-lock.json"));
  const workspacePackages = [];

  for (const workspaceRoot of ["apps", "packages"]) {
    for (const entry of await readdir(join(rootDir, workspaceRoot), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(rootDir, workspaceRoot, entry.name, "package.json");
      try {
        const manifest = await readJson(manifestPath);
        workspacePackages.push({ path: `${workspaceRoot}/${entry.name}/package.json`, manifest });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }

  return { rootPackage, lockfile, workspacePackages };
}

export function validateReleaseMetadata({ rootPackage, lockfile, workspacePackages }, { tag } = {}) {
  const version = String(rootPackage?.version ?? "");
  if (!SEMVER.test(version)) {
    throw new Error(`Root package version '${version}' is not valid semantic versioning.`);
  }

  for (const { path, manifest } of workspacePackages) {
    if (manifest.version !== version) {
      throw new Error(`${path} version '${manifest.version ?? "missing"}' does not match root version '${version}'.`);
    }
  }

  if (lockfile?.version !== version || lockfile?.packages?.[""]?.version !== version) {
    throw new Error(`package-lock.json root version does not match '${version}'.`);
  }
  for (const { path, manifest } of workspacePackages) {
    const lockPath = path.replace(/\/package\.json$/, "");
    const lockVersion = lockfile?.packages?.[lockPath]?.version;
    if (lockVersion !== manifest.version) {
      throw new Error(`package-lock.json entry '${lockPath}' version '${lockVersion ?? "missing"}' does not match '${manifest.version}'.`);
    }
  }

  if (tag && tag !== `v${version}`) {
    throw new Error(`Release tag '${tag}' does not match package version 'v${version}'.`);
  }
  return { version, tag: tag || null };
}

export async function verifyReleaseMetadata(rootDir, options = {}) {
  return validateReleaseMetadata(await readReleaseMetadata(rootDir), options);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
