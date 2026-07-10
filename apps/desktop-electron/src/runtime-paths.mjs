import { dirname, join, resolve } from "node:path";

export function desktopRuntimePaths(appPath) {
  const resourceRoot = appPath.endsWith("app.asar") ? `${appPath}.unpacked` : appPath;
  return {
    childEntry: join(resourceRoot, "src/server-child.mjs"),
    runtimeRoot: join(resourceRoot, "runtime")
  };
}

export function desktopPortablePaths({ appPath, execPath, isPackaged, platform }) {
  const appDirectory = !isPackaged
    ? appPath
    : platform === "darwin"
      ? resolve(dirname(execPath), "../../..")
      : dirname(execPath);
  const dataRoot = join(appDirectory, "ReignsAgentData");
  return {
    dataRoot,
    sessionData: join(dataRoot, "SessionData"),
    builds: join(dataRoot, "Builds")
  };
}
