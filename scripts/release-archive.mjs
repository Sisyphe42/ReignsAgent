import { readFile } from "node:fs/promises";

import { unzipSync } from "fflate";

export const PROJECT_LICENSE_NAME = "LICENSE.reigns-agent.txt";
export const THIRD_PARTY_NOTICES_NAME = "THIRD_PARTY_NOTICES.md";

export async function readZipEntryNames(archivePath) {
  const entries = unzipSync(new Uint8Array(await readFile(archivePath)));
  return Object.keys(entries).map(normalizeEntryName).sort();
}

export function validatePortableArchiveEntries(names, { kind, platform, version }) {
  if (!Array.isArray(names) || names.length === 0) throw new Error("Release archive is empty.");
  const unsafe = names.find((name) => isUnsafeArchivePath(name));
  if (unsafe) throw new Error(`Release archive contains unsafe or private path '${unsafe}'.`);

  if (kind === "node") {
    const prefix = `reigns-agent-${version}/`;
    assertOnlyPrefix(names, prefix);
    assertEntries(names, [
      `${prefix}creator/index.html`,
      `${prefix}start.mjs`,
      `${prefix}${PROJECT_LICENSE_NAME}`,
      `${prefix}${THIRD_PARTY_NOTICES_NAME}`
    ]);
    return names;
  }

  if (kind !== "desktop") throw new Error(`Unsupported release archive kind '${kind}'.`);
  const roots = new Set(names.map((name) => name.split("/")[0]).filter(Boolean));
  if (roots.size !== 1) throw new Error(`Desktop ZIP must contain one top-level directory; found ${roots.size}.`);
  const [root] = roots;
  assertEntries(names, [`${root}/${PROJECT_LICENSE_NAME}`, `${root}/${THIRD_PARTY_NOTICES_NAME}`]);

  const marker = {
    win32: `${root}/ReignsAgent.exe`,
    darwin: `${root}/ReignsAgent.app/Contents/MacOS/ReignsAgent`,
    linux: `${root}/ReignsAgent`
  }[platform];
  if (!marker) throw new Error(`Unsupported desktop platform '${platform}'.`);
  assertEntries(names, [marker]);
  return names;
}

export function isUnsafeArchivePath(name) {
  const segments = normalizeEntryName(name).split("/").filter(Boolean);
  return segments.includes("..")
    || segments.includes("ReignsAgentData")
    || segments.includes("node_modules")
    || segments.includes("test")
    || segments.some((segment) => segment === ".env" || segment.startsWith(".env."))
    || normalizeEntryName(name).includes("/apps/creator-web/src/")
    || normalizeEntryName(name).includes(".test.");
}

function assertOnlyPrefix(names, prefix) {
  const outside = names.find((name) => name !== prefix.slice(0, -1) && !name.startsWith(prefix));
  if (outside) throw new Error(`Release archive entry '${outside}' is outside '${prefix}'.`);
}

function assertEntries(names, required) {
  for (const entry of required) {
    if (!names.includes(entry)) throw new Error(`Release archive is missing '${entry}'.`);
  }
}

function normalizeEntryName(name) {
  return String(name).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}
