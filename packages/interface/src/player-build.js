/**
 * Stitch the headless Core source into the deployable player runtime template.
 * The result is browser-ready and has no repo-relative imports.
 */
export function stitchPlayerRuntime(template, coreSource) {
  if (!template.includes("/* CORE_IMPORT_MARKER */")) {
    throw new Error("Player runtime template is missing the CORE_IMPORT_MARKER");
  }
  const inlinedCore = coreSource
    .replace(/export\s+const\s+FACTIONS\s*=/, "const FACTIONS =")
    .replace(/export\s+const\s+LEGACY_FACTION_KEYS\s*=/, "const LEGACY_FACTION_KEYS =")
    .replace(/export\s+class\s+CoreError/g, "class CoreError")
    .replace(
      /export\s+function\s+(createInitialState|createRuntime|getEligibleCards|normalizeFactionKey|normalizeCards|restoreState|serializeState|validateCards)/g,
      "function $1"
    );
  return template.replace("/* CORE_IMPORT_MARKER */", `${inlinedCore}\nconst createCoreRuntime = createRuntime;`);
}
