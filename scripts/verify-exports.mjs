import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const modules = [
  {
    path: "packages/core/src/index.js",
    exports: [
      "CoreError",
      "FACTIONS",
      "LEGACY_FACTION_KEYS",
      "createInitialState",
      "createRuntime",
      "getEligibleCards",
      "normalizeFactionKey",
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
      "applyAiEditPatches",
      "assertValidCardSet",
      "buildAssetGenerationRequest",
      "buildAiContext",
      "buildCardEditRequest",
      "buildCardGenerationRequest",
      "buildCardGenerationPrompt",
      "buildMediaEditRequest",
      "createAiEditSuggestions",
      "createAiEditSuggestionsFromEndpoint",
      "createContentBundle",
      "createDiagnosticFeedback",
      "createLLMConnector",
      "generateAssetDrafts",
      "generateCardDrafts",
      "listAiEndpointModels",
      "parseContentJson",
      "parseCardsCsv",
      "parseCardsJson",
      "readContentJson",
      "readCardsCsv",
      "readCardsJson",
      "stringifyContentJson",
      "stringifyCardsCsv",
      "stringifyCardsJson",
      "validateAiEditEndpoint",
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
      "applyAiEditPlan",
      "buildAiEditPlan",
      "buildAiEditPlanAsync",
      "buildGenerationPlan",
      "createCardEditor",
      "createConnectorConfig",
      "createI18nCatalog",
      "createPlaySession",
      "listAiEditEndpointModels",
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
      "validateAiEditEndpointConfig",
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
