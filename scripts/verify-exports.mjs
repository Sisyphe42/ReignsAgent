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
      "buildCardGenerationPrompt",
      "createDiagnosticFeedback",
      "createLLMConnector",
      "generateAssetDrafts",
      "generateCardDrafts",
      "parseCardsCsv",
      "parseCardsJson",
      "readCardsCsv",
      "readCardsJson",
      "stringifyCardsCsv",
      "stringifyCardsJson",
      "validateCardSet",
      "writeCardsCsv",
      "writeCardsJson"
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
