#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCreatorServer } from "../apps/creator-server/src/server.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const staticRoot = process.env.REIGNS_AGENT_STATIC_ROOT
  ? resolve(process.env.REIGNS_AGENT_STATIC_ROOT)
  : null;
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4321);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`PORT must be an integer from 0 to 65535, got '${process.env.PORT}'.`);
}

const creatorServer = await createCreatorServer({ rootDir, staticRoot });
await creatorServer.start({ host, port });
