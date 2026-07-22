import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const WORKFLOW = await readFile(new URL("../../.github/workflows/desktop.yml", import.meta.url), "utf8");
const CI_WORKFLOW = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

describe("release workflow contract", () => {
  it("builds all five archives and assembles them on manual runs", () => {
    assert.match(WORKFLOW, /workflow_dispatch:/);
    assert.match(WORKFLOW, /build-node:/);
    assert.match(WORKFLOW, /ReignsAgent-node/);
    for (const artifact of ["windows-x64", "macos-x64", "macos-arm64", "linux-x64"]) {
      assert.match(WORKFLOW, new RegExp(`ReignsAgent-${artifact}`));
    }
    assert.match(WORKFLOW, /assemble-release:/);
    assert.match(WORKFLOW, /scripts\/assemble-release\.mjs/);
    assert.match(WORKFLOW, /SHA256SUMS\.txt/);
  });

  it("grants write permission only to tag-gated publication", () => {
    assert.match(WORKFLOW, /^permissions:\s*\n\s+contents: read/m);
    const publish = WORKFLOW.slice(WORKFLOW.indexOf("  publish-release:"));
    assert.match(publish, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
    assert.match(publish, /permissions:\s*\n\s+contents: write/);
    assert.match(publish, /verify-release-metadata\.mjs --tag/);
    assert.match(publish, /gh release create/);
    assert.doesNotMatch(WORKFLOW.slice(0, WORKFLOW.indexOf("  publish-release:")), /contents: write/);
  });

  it("builds and smokes the web apps when a release tag is pushed", () => {
    assert.match(CI_WORKFLOW, /tags:\s*\["v\*"\]/);
    assert.match(CI_WORKFLOW, /npm run verify/);
    assert.match(CI_WORKFLOW, /npm run build:hosted/);
    assert.match(CI_WORKFLOW, /npm run test:hosted/);
  });
});
