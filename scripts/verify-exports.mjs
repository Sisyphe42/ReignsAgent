import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const modules = [
  {
    path: "packages/core/src/index.js",
    exports: [
      "CoreError",
      "FACTIONS",
      "createInitialState",
      "createRuntime",
      "getEligibleCards",
      "normalizeCards",
      "restoreState",
      "serializeState",
      "validateCards"
    ]
  },
  {
    path: "packages/reviewer/src/index.js",
    exports: ["ReviewerError", "analyzeCardGraph", "runMonteCarloReview", "runSimulationCycle"]
  },
  {
    path: "packages/pipeline/src/index.js",
    exports: [
      "PipelineError",
      "assertValidCardSet",
      "buildAssetGenerationRequest",
      "buildCardGenerationRequest",
      "buildCardGenerationPrompt",
      "createContentBundle",
      "createDiagnosticFeedback",
      "createLLMConnector",
      "generateAssetDrafts",
      "generateCardDrafts",
      "parseContentJson",
      "parseCardsCsv",
      "parseCardsJson",
      "readContentJson",
      "readCardsCsv",
      "readCardsJson",
      "stringifyContentJson",
      "stringifyCardsCsv",
      "stringifyCardsJson",
      "validateContentBundle",
      "validateCardSet",
      "writeContentJson",
      "writeCardsCsv",
      "writeCardsJson"
    ]
  },
  {
    path: "packages/interface/src/index.js",
    exports: [
      "FACTION_KEYS",
      "InterfaceError",
      "buildGenerationPlan",
      "createCardEditor",
      "createConnectorConfig",
      "createI18nCatalog",
      "createPlaySession",
      "loadEditorFromContent",
      "localizeCard",
      "localizeCards",
      "normalizePresentationConfig",
      "prepareGameBuild",
      "projectFactionGauges",
      "resolveLocale",
      "runDiagnostics",
      "serializeBuild",
      "summarizeDiagnostics",
      "summarizeFeedback",
      "validatePlayerCards"
    ]
  }
];

for (const moduleDefinition of modules) {
  const loaded = await import(pathToFileURL(resolve(moduleDefinition.path)));

  for (const exportName of moduleDefinition.exports) {
    if (!(exportName in loaded)) {
      throw new Error(`${moduleDefinition.path} is missing export '${exportName}'`);
    }
  }
}

console.log(`Export verification passed for ${modules.length} packages.`);
