import { fileURLToPath } from "node:url";

const iconBase = fileURLToPath(new URL("./assets/icon", import.meta.url));
const pngIcon = fileURLToPath(new URL("./assets/icon.png", import.meta.url));

export default {
  packagerConfig: {
    asar: true,
    appBundleId: "io.reignsagent.app",
    executableName: "ReignsAgent",
    icon: iconBase
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "ReignsAgent",
        authors: "ReignsAgent contributors",
        description: "ReignsAgent narrative card game Creator"
      }
    },
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: { name: "ReignsAgent" }
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"]
    },
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: {
        options: {
          name: "reignsagent",
          productName: "ReignsAgent",
          genericName: "Narrative Game Creator",
          categories: ["Development", "Game"],
          icon: pngIcon
        }
      }
    },
    {
      name: "@electron-forge/maker-rpm",
      platforms: ["linux"],
      config: {
        options: {
          name: "reignsagent",
          productName: "ReignsAgent",
          genericName: "Narrative Game Creator",
          categories: ["Development", "Game"],
          icon: pngIcon
        }
      }
    }
  ]
};
