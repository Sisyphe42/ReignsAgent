#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = join(ROOT, "apps/desktop-electron/out");
const platform = process.argv[2] ?? process.platform;
const architecture = process.argv[3] ?? process.arch;
const archiveRoot = process.argv[4] ? resolve(process.argv[4]) : null;
let extractedRoot = null;
let copiedRoot = null;

try {
  if (archiveRoot) extractedRoot = await extractPortableArchive(archiveRoot, platform);
  let packageDirectory = await findPackageDirectory(extractedRoot ?? outputRoot, platform, architecture);
  if (!archiveRoot) {
    copiedRoot = await mkdtemp(join(tmpdir(), "reigns-packaged-smoke-"));
    const copiedPackage = join(copiedRoot, basename(packageDirectory));
    await cp(packageDirectory, copiedPackage, { recursive: true });
    await rm(join(copiedPackage, "ReignsAgentData"), { recursive: true, force: true });
    packageDirectory = copiedPackage;
  }
  const executable = packagedExecutable(packageDirectory, platform);
  const resources = packagedResources(packageDirectory, platform);
  const portableData = join(packageDirectory, "ReignsAgentData");
  await access(executable);
  await access(join(resources, "app.asar.unpacked", "src/server-child.mjs"));
  await access(join(resources, "app.asar.unpacked", "runtime/package.json"));
  await access(join(resources, "app.asar.unpacked", "runtime/apps/creator-server/src/server.mjs"));
  if (archiveRoot && await pathExists(portableData)) {
    throw new Error("Portable archive must not contain pre-existing ReignsAgentData.");
  }

  const smokeArgs = ["--smoke-test"];
  if (platform === "linux" && process.env.CI) smokeArgs.push("--no-sandbox");
  await run(executable, smokeArgs, { cwd: packageDirectory, env: process.env });
  await run(executable, smokeArgs, {
    cwd: packageDirectory,
    env: { ...process.env, REIGNS_AGENT_SMOKE_EXPECT_PERSISTENCE: "1" }
  });
  await access(join(portableData, "config.toml"));
  await access(join(portableData, "projects"));
  await access(join(portableData, "Builds"));
  await access(join(portableData, "SessionData"));
  console.log(`Packaged Electron smoke passed: ${executable}`);
} finally {
  if (extractedRoot) await removeTemporaryTree(extractedRoot);
  if (copiedRoot) await removeTemporaryTree(copiedRoot);
}

async function removeTemporaryTree(path) {
  await rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}

async function findPackageDirectory(root, targetPlatform, targetArchitecture) {
  const suffix = `-${targetPlatform}-${targetArchitecture}`;
  const entries = await readdir(root, { withFileTypes: true });
  const match = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(suffix));
  if (!match) throw new Error(`No packaged Electron directory ending in '${suffix}' was found under ${root}.`);
  return resolve(root, match.name);
}

async function extractPortableArchive(root, targetPlatform) {
  const archives = (await collectFiles(root)).filter((file) => file.toLowerCase().endsWith(".zip"));
  if (archives.length !== 1) throw new Error(`Expected one portable ZIP under ${root}, found ${archives.length}.`);
  const target = await mkdtemp(join(tmpdir(), "reigns-portable-smoke-"));
  try {
    if (targetPlatform === "win32") {
      const script = [
        "Add-Type -AssemblyName System.IO.Compression.FileSystem",
        "[IO.Compression.ZipFile]::ExtractToDirectory($env:REIGNS_AGENT_ZIP_SOURCE, $env:REIGNS_AGENT_ZIP_TARGET)"
      ].join("; ");
      await run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
        env: {
          ...process.env,
          REIGNS_AGENT_ZIP_SOURCE: archives[0],
          REIGNS_AGENT_ZIP_TARGET: target
        }
      });
    } else {
      await run("unzip", ["-q", archives[0], "-d", target]);
    }
    return target;
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

async function collectFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { ...options, stdio: "inherit", windowsHide: true });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} failed with code ${code} and signal ${signal}.`));
    });
  });
}

function packagedExecutable(packageDirectory, targetPlatform) {
  if (targetPlatform === "win32") return join(packageDirectory, "ReignsAgent.exe");
  if (targetPlatform === "darwin") {
    return join(packageDirectory, "ReignsAgent.app", "Contents", "MacOS", "ReignsAgent");
  }
  if (targetPlatform === "linux") return join(packageDirectory, "ReignsAgent");
  throw new Error(`Unsupported desktop platform '${targetPlatform}'.`);
}

function packagedResources(packageDirectory, targetPlatform) {
  if (targetPlatform === "darwin") {
    return join(packageDirectory, "ReignsAgent.app", "Contents", "Resources");
  }
  if (targetPlatform === "win32" || targetPlatform === "linux") return join(packageDirectory, "resources");
  throw new Error(`Unsupported desktop platform '${targetPlatform}'.`);
}
