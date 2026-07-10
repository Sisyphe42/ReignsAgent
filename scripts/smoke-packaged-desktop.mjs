#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = join(ROOT, "apps/desktop-electron/out");
const platform = process.argv[2] ?? process.platform;
const architecture = process.argv[3] ?? process.arch;
const packageDirectory = await findPackageDirectory(platform, architecture);
const executable = packagedExecutable(packageDirectory, platform);
const resources = packagedResources(packageDirectory, platform);
await access(executable);
await access(join(resources, "app.asar.unpacked", "src/server-child.mjs"));
await access(join(resources, "app.asar.unpacked", "runtime/apps/creator-server/src/server.mjs"));

await new Promise((resolveRun, rejectRun) => {
  const child = spawn(executable, ["--smoke-test"], {
    cwd: packageDirectory,
    env: process.env,
    stdio: "inherit",
    windowsHide: true
  });
  child.once("error", rejectRun);
  child.once("exit", (code, signal) => {
    if (code === 0) resolveRun();
    else rejectRun(new Error(`Packaged Electron smoke test failed with code ${code} and signal ${signal}.`));
  });
});

console.log(`Packaged Electron smoke passed: ${executable}`);

async function findPackageDirectory(targetPlatform, targetArchitecture) {
  const suffix = `-${targetPlatform}-${targetArchitecture}`;
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const match = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(suffix));
  if (!match) throw new Error(`No packaged Electron directory ending in '${suffix}' was found under ${outputRoot}.`);
  return resolve(outputRoot, match.name);
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
