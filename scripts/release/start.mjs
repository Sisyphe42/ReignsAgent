#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST ?? "127.0.0.1";
const requestedPort = Number(process.env.PORT ?? 4321);
const shouldOpen = !process.argv.includes("--no-open");

if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
  console.error(`PORT must be an integer from 0 to 65535, got '${process.env.PORT}'.`);
  process.exit(1);
}

process.env.REIGNS_AGENT_STATIC_ROOT = join(ROOT, "creator");
const dataRoot = process.env.REIGNS_AGENT_DATA_ROOT
  ? process.env.REIGNS_AGENT_DATA_ROOT
  : join(ROOT, "ReignsAgentData");
const { createCreatorServer } = await import("./apps/creator-server/src/server.mjs");
const creatorServer = await createCreatorServer({ rootDir: ROOT, staticRoot: process.env.REIGNS_AGENT_STATIC_ROOT, dataRoot });
const address = await creatorServer.start({ host, port: requestedPort });
const url = `http://${displayHost(address.host)}:${address.port}/workbench`;

if (shouldOpen) {
  openBrowser(url);
}

function displayHost(value) {
  return value === "0.0.0.0" || value === "::" ? "127.0.0.1" : value;
}

function openBrowser(url) {
  const command = process.platform === "win32"
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  const child = spawn(command[0], command[1], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.on("error", () => {});
  child.unref();
}
