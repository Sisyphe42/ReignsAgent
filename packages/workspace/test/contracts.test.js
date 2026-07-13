import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig, mergeConfig, normalizeWorkspaceState, parseBundle, parseToml, projectConfig, stringifyToml } from "../src/contracts.js";

describe("workspace host-neutral contracts", () => {
  it("defaults the interface language to the current client environment", () => {
    assert.equal(defaultConfig().locale, "system");
  });

  it("round-trips browser and Node configuration without exposing a key projection", () => {
    const stored = mergeConfig(defaultConfig(), { theme: "phantom", ai: { endpoint: "https://ai.example/v1", apiKey: "secret" } });
    const restored = parseToml(stringifyToml(stored));
    assert.deepEqual(restored, stored);
    assert.equal(projectConfig(restored).ai.hasApiKey, true);
    assert.equal("apiKey" in projectConfig(restored).ai, false);
  });

  it("normalizes project UI state and rejects malformed content", () => {
    assert.deepEqual(normalizeWorkspaceState({ activePanel: "review" }), { schemaVersion: 1, activePanel: "review", selectedCardId: "", previewSkin: "" });
    assert.throws(() => parseBundle({ metadata: {} }, "broken"), { code: "project_content_invalid" });
  });
});
