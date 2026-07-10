import process from "node:process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const runtimeRoot = process.env.REIGNS_AGENT_RUNTIME_ROOT;
const buildOutputDir = process.env.REIGNS_AGENT_BUILD_OUTPUT_DIR;

if (!runtimeRoot || !buildOutputDir || !process.parentPort) {
  throw new Error("Desktop Creator Server requires runtime, build output, and an Electron parent port.");
}

const serverModule = pathToFileURL(join(runtimeRoot, "apps/creator-server/src/server.mjs")).href;
const { createCreatorServer } = await import(serverModule);
const creatorServer = await createCreatorServer({
  rootDir: runtimeRoot,
  staticRoot: join(runtimeRoot, "creator"),
  defaultBuildOutputDir: buildOutputDir
});
const address = await creatorServer.start({ host: "127.0.0.1", port: 0 });
process.parentPort.postMessage({ type: "ready", address });

process.parentPort.on("message", async (event) => {
  if (event.data?.type !== "shutdown") return;
  await creatorServer.close();
  process.parentPort.postMessage({ type: "stopped" });
  process.exit(0);
});
