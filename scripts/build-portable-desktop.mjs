#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const desktopRoot = join(ROOT, "apps/desktop-electron");
const outputRoot = join(desktopRoot, "out");
const args = parseArgs(process.argv.slice(2));
const platform = args.platform ?? process.platform;
const architecture = args.arch ?? process.arch;
if (platform !== process.platform) {
  throw new Error(`Portable archives must be built on their native platform: requested ${platform}, running ${process.platform}.`);
}

const desktopPackage = JSON.parse(await readFile(join(desktopRoot, "package.json"), "utf8"));
const packageDirectory = await findPackageDirectory(platform, architecture);
const archiveDirectory = join(outputRoot, "make", "zip", platform, architecture);
const archive = join(
  archiveDirectory,
  `ReignsAgent-${platform}-${architecture}-${desktopPackage.version}.zip`
);

await rm(join(packageDirectory, "ReignsAgentData"), { recursive: true, force: true });
await mkdir(archiveDirectory, { recursive: true });
await rm(archive, { force: true });

if (platform === "win32") {
  const script = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    "[IO.Compression.ZipFile]::CreateFromDirectory($env:REIGNS_AGENT_ZIP_SOURCE, $env:REIGNS_AGENT_ZIP_TARGET, [IO.Compression.CompressionLevel]::Optimal, $true)"
  ].join("; ");
  await run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    env: {
      ...process.env,
      REIGNS_AGENT_ZIP_SOURCE: packageDirectory,
      REIGNS_AGENT_ZIP_TARGET: archive
    }
  });
} else {
  await run("zip", ["-r", "-y", archive, basename(packageDirectory)], { cwd: dirname(packageDirectory) });
}

console.log(JSON.stringify({ portable: true, platform, architecture, packageDirectory, archive }, null, 2));

async function findPackageDirectory(targetPlatform, targetArchitecture) {
  const suffix = `-${targetPlatform}-${targetArchitecture}`;
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const match = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(suffix));
  if (!match) throw new Error(`No packaged Electron directory ending in '${suffix}' was found under ${outputRoot}.`);
  return resolve(outputRoot, match.name);
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, { ...options, stdio: "inherit", windowsHide: true });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} failed with code ${code} and signal ${signal}.`));
    });
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || !["--platform", "--arch"].includes(key)) {
      throw new Error("Usage: node scripts/build-portable-desktop.mjs [--platform <win32|darwin|linux>] [--arch <architecture>]");
    }
    parsed[key.slice(2)] = value;
  }
  return parsed;
}
