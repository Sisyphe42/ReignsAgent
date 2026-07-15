#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEBVIEW2_VERSION = "1.0.4078.44";
const optional = process.argv.includes("--if-supported");
if (process.platform !== "win32" || process.arch !== "x64") {
  if (optional) {
    console.log(JSON.stringify({ built: false, target: "windows-x64", reason: "unsupported_host" }, null, 2));
    process.exit(0);
  }
  throw new Error("The Windows player host must be built on Windows x64.");
}
const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
const { stdout } = await execFileAsync(vswhere, [
  "-latest", "-products", "*", "-requires", "Microsoft.Component.MSBuild", "-find", "MSBuild\\**\\Bin\\MSBuild.exe"
]);
const msbuild = stdout.trim().split(/\r?\n/)[0];
if (!msbuild) throw new Error("Visual Studio 2022 MSBuild with C++ tools is required.");
const project = join(ROOT, "apps/player-windows/ReignsAgentPlayer.vcxproj");
const packageDir = join(ROOT, `apps/player-windows/packages/Microsoft.Web.WebView2.${WEBVIEW2_VERSION}`);
try {
  await access(join(packageDir, "build/native/Microsoft.Web.WebView2.targets"));
} catch {
  const packageUrl = `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${WEBVIEW2_VERSION}/microsoft.web.webview2.${WEBVIEW2_VERSION}.nupkg`;
  const response = await fetch(packageUrl);
  if (!response.ok) throw new Error(`WebView2 SDK download failed (${response.status}).`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  for (const [relativePath, bytes] of Object.entries(entries)) {
    if (relativePath.endsWith("/")) continue;
    const destination = resolve(packageDir, ...relativePath.split("/"));
    const packageRelativePath = relative(packageDir, destination);
    if (packageRelativePath.startsWith("..") || isAbsolute(packageRelativePath)) {
      throw new Error(`WebView2 SDK contains an unsafe path: ${relativePath}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
}
await rm(join(ROOT, "apps/player-windows/obj"), { recursive: true, force: true });
await mkdir(join(ROOT, "apps/player-windows/out/win-x64"), { recursive: true });
await execFileAsync(msbuild, [project, "-m", "-p:Configuration=Release", "-p:Platform=x64", "-v:minimal"], {
  cwd: ROOT,
  maxBuffer: 16 * 1024 * 1024
});
const output = join(ROOT, "apps/player-windows/out/win-x64/ReignsAgentPlayer.exe");
await access(output);
console.log(JSON.stringify({ built: true, target: "windows-x64", output }, null, 2));
