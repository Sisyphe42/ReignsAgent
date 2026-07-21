import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateReleaseMetadata } from "../../scripts/release-metadata.mjs";

function metadata(overrides = {}) {
  const version = overrides.rootVersion ?? "0.1.0";
  return {
    rootPackage: { version },
    workspacePackages: [{ path: "apps/example/package.json", manifest: { version: overrides.workspaceVersion ?? version } }],
    lockfile: {
      version: overrides.lockRootVersion ?? version,
      packages: {
        "": { version: overrides.lockRootPackageVersion ?? version },
        "apps/example": { version: overrides.lockWorkspaceVersion ?? version }
      }
    }
  };
}

describe("release metadata", () => {
  it("accepts matching package, lockfile, and tag versions", () => {
    assert.deepEqual(validateReleaseMetadata(metadata(), { tag: "v0.1.0" }), { version: "0.1.0", tag: "v0.1.0" });
  });

  it("rejects workspace and lockfile version drift", () => {
    assert.throws(() => validateReleaseMetadata(metadata({ workspaceVersion: "0.1.1" })), /does not match root version/);
    assert.throws(() => validateReleaseMetadata(metadata({ lockWorkspaceVersion: "0.1.1" })), /package-lock\.json entry/);
    assert.throws(() => validateReleaseMetadata(metadata({ lockRootVersion: "0.1.1" })), /root version does not match/);
  });

  it("rejects invalid versions and mismatching release tags", () => {
    assert.throws(() => validateReleaseMetadata(metadata({ rootVersion: "first" })), /semantic versioning/);
    assert.throws(() => validateReleaseMetadata(metadata(), { tag: "v0.1.1" }), /does not match package version/);
  });
});
