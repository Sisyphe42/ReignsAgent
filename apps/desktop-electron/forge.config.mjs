import { fileURLToPath } from "node:url";

const iconBase = fileURLToPath(new URL("./assets/icon", import.meta.url));
const electronZipDir = process.env.ELECTRON_ZIP_DIR;

export default {
  packagerConfig: {
    asar: {
      unpack: "**/server-child.mjs",
      unpackDir: "runtime"
    },
    prune: false,
    ...(electronZipDir ? { electronZipDir } : {}),
    appBundleId: "io.reignsagent.app",
    executableName: "ReignsAgent",
    icon: iconBase,
    appCopyright: "Copyright © 2026 Sisyphe42",
    win32metadata: {
      CompanyName: "Sisyphe42",
      FileDescription: "ReignsAgent",
      InternalName: "ReignsAgent",
      OriginalFilename: "ReignsAgent.exe",
      ProductName: "ReignsAgent"
    }
  },
  makers: []
};
