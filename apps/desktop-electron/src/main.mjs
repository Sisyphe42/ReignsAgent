import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, session, utilityProcess } from "electron";
import squirrelStartup from "electron-squirrel-startup";

import { desktopBuildOutputDir, isAllowedAppUrl } from "./security.mjs";

const smokeTest = process.argv.includes("--smoke-test");
const childEntry = fileURLToPath(new URL("./server-child.mjs", import.meta.url));
let mainWindow = null;
let serverProcess = null;
let serverOrigin = null;
let quitting = false;

if (squirrelStartup) {
  app.quit();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(startDesktop).catch((error) => {
    console.error(error);
    process.exitCode = 1;
    app.quit();
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
    const response = await fetch(`${serverOrigin}/api/editor`);
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.cards)) {
      throw new Error("Electron smoke test could not read the Creator API.");
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
  const runtimeRoot = join(app.getAppPath(), "runtime");
  const buildOutputDir = desktopBuildOutputDir(app.getPath("documents"));
  serverProcess = utilityProcess.fork(childEntry, [], {
    cwd: app.getAppPath(),
    env: {
      ...process.env,
      REIGNS_AGENT_RUNTIME_ROOT: runtimeRoot,
      REIGNS_AGENT_BUILD_OUTPUT_DIR: buildOutputDir
    },
    serviceName: "ReignsAgent Creator Server",
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
      if (message?.type !== "ready") return;
      clearTimeout(timeout);
      serverProcess?.off("exit", onExit);
      resolveStart(message.address.origin);
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
