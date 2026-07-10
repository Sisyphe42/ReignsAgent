import { join } from "node:path";

export function desktopRuntimePaths(appPath) {
  const resourceRoot = appPath.endsWith("app.asar") ? `${appPath}.unpacked` : appPath;
  return {
    childEntry: join(resourceRoot, "src/server-child.mjs"),
    runtimeRoot: join(resourceRoot, "runtime")
  };
}
