import { strToU8, zipSync } from "fflate";
import { prepareGameBuild, serializeBuild, stitchPlayerRuntime, validatePlayerCards } from "../../../packages/interface/src/index.js";
import coreSource from "../../../packages/core/src/index.js?raw";
import playerRuntimeTemplate from "../../../packages/interface/web/player-runtime.js?raw";
import playerHtml from "../../../packages/interface/web/standalone-player.html?raw";

const bundledTextAssets = import.meta.glob("../../../packages/interface/web/assets/sample/*", { eager: true, query: "?raw", import: "default" });

export function assemblePlayerFiles({ editor, config = null, buildId = null, logoBytes = null }) {
  const validation = validatePlayerCards(editor.toCards());
  if (!validation.valid) throw new Error(`Cannot build: ${validation.errors.join("; ")}`);
  const build = prepareGameBuild({ editor, config, buildId });
  const runtime = stitchPlayerRuntime(playerRuntimeTemplate, coreSource);
  const deployable = { ...build, player: { ...build.player, runtime, entry: "player-runtime.js" } };
  const files = {
    [`${build.buildId}.game.json`]: strToU8(serializeBuild(deployable)),
    "player-runtime.js": strToU8(runtime),
    "player.html": strToU8(playerHtml)
  };
  if (logoBytes) files["assets/logo-alpha.png"] = logoBytes;
  for (const [sourcePath, contents] of Object.entries(bundledTextAssets)) {
    files[`assets/sample/${sourcePath.split("/").at(-1)}`] = strToU8(contents);
  }
  return { build, files };
}

export async function downloadPlayerZip(options) {
  const logoUrl = new URL(`${import.meta.env.BASE_URL}logo-alpha.png`, location.origin);
  const logoResponse = await fetch(logoUrl);
  const logoBytes = logoResponse.ok ? new Uint8Array(await logoResponse.arrayBuffer()) : null;
  const { build, files } = assemblePlayerFiles({ ...options, logoBytes });
  const blob = new Blob([zipSync(files, { level: 6 })], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${build.buildId}.zip`; anchor.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  return { buildId: build.buildId, fileName: `${build.buildId}.zip` };
}

export { stitchPlayerRuntime };
