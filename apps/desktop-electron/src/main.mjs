import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { app, BrowserWindow, session, utilityProcess } from "electron";

import { desktopPortablePaths, desktopRuntimePaths } from "./runtime-paths.mjs";
import { isAllowedAppUrl } from "./security.mjs";

const smokeTest = process.argv.includes("--smoke-test");
let mainWindow = null;
let serverProcess = null;
let serverOrigin = null;
let quitting = false;
const portablePaths = desktopPortablePaths({
  appPath: app.getAppPath(),
  execPath: process.execPath,
  isPackaged: app.isPackaged,
  platform: process.platform
});
mkdirSync(portablePaths.sessionData, { recursive: true });
mkdirSync(portablePaths.builds, { recursive: true });
app.setPath("userData", portablePaths.dataRoot);
app.setPath("sessionData", portablePaths.sessionData);

if (!smokeTest && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(startDesktop).catch((error) => {
    console.error(error);
    app.exit(1);
  });

  app.on("activate", () => {
    if (!mainWindow && serverOrigin) createMainWindow(serverOrigin);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (!serverProcess || quitting) return;
    event.preventDefault();
    quitting = true;
    stopCreatorServer().finally(() => app.quit());
  });
}

async function startDesktop() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  serverOrigin = await startCreatorServer();

  if (smokeTest) {
    const editorResponse = await fetch(`${serverOrigin}/api/editor`);
    const editor = await editorResponse.json();
    if (!editorResponse.ok || !Array.isArray(editor.cards)) {
      throw new Error("Electron smoke test could not read the Creator API.");
    }
    if (process.env.REIGNS_AGENT_SMOKE_EXPECT_PERSISTENCE === "1") {
      const config = await fetch(`${serverOrigin}/api/config`).then((response) => response.json());
      if (editor.metadata?.title !== "Desktop persistence smoke" || config.theme !== "phantom") {
        throw new Error("Electron smoke test could not restore portable Creator state.");
      }
    } else {
      await fetch(`${serverOrigin}/api/editor/metadata`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metadata: { title: "Desktop persistence smoke" } })
      });
      await fetch(`${serverOrigin}/api/config`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: "phantom" })
      });
    }
    console.log(`ReignsAgent desktop smoke passed: ${serverOrigin}`);
    quitting = true;
    await stopCreatorServer();
    app.quit();
    return;
  }

  createMainWindow(serverOrigin);
}

function createMainWindow(origin) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: "#171813",
    icon: join(app.getAppPath(), "assets/icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedAppUrl(targetUrl, origin)) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  void mainWindow.loadURL(`${origin}/workbench`);
}

function startCreatorServer() {
  const { childEntry, runtimeRoot } = desktopRuntimePaths(app.getAppPath());
  serverProcess = utilityProcess.fork(childEntry, [], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      REIGNS_AGENT_RUNTIME_ROOT: runtimeRoot,
      REIGNS_AGENT_DATA_ROOT: portablePaths.dataRoot,
      REIGNS_AGENT_BUILD_OUTPUT_DIR: portablePaths.builds
    },
    serviceName: "ReignsAgent Server",
    stdio: "pipe"
  });
  serverProcess.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  serverProcess.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  return new Promise((resolveStart, rejectStart) => {
    const timeout = setTimeout(() => rejectStart(new Error("Creator Server startup timed out.")), 15_000);
    const onExit = (code) => {
      clearTimeout(timeout);
      rejectStart(new Error(`Creator Server exited before startup with code ${code}.`));
    };
    serverProcess.once("exit", onExit);
    serverProcess.on("message", (message) => {
      if (message?.type === "status") {
        console.log(`Creator Server startup: ${message.stage}`);
        return;
      }
      if (message?.type === "error") {
        clearTimeout(timeout);
        serverProcess?.off("exit", onExit);
        rejectStart(new Error(`Creator Server failed during ${message.stage}: ${message.error?.message ?? "unknown error"}`));
        return;
      }
      if (message?.type === "ready") {
        clearTimeout(timeout);
        serverProcess?.off("exit", onExit);
        resolveStart(message.address.origin);
      }
    });
  });
}

function stopCreatorServer() {
  const child = serverProcess;
  serverProcess = null;
  if (!child?.pid) return Promise.resolve();
  return new Promise((resolveStop) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolveStop();
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
    child.postMessage({ type: "shutdown" });
  });
}
