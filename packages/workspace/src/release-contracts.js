import { randomUUID } from "node:crypto";

export const RELEASE_RECORD_SCHEMA_VERSION = 1;
export const WINDOWS_RELEASE_TARGET = "windows-x64";

export function createReleaseRecord({ projectId, build, artifactRelativePath, size, sha256, createdAt = new Date().toISOString() }) {
  return normalizeReleaseRecord({
    schemaVersion: RELEASE_RECORD_SCHEMA_VERSION,
    id: randomUUID(),
    projectId,
    buildId: build?.buildId,
    title: build?.title,
    version: build?.version,
    target: WINDOWS_RELEASE_TARGET,
    createdAt,
    artifactRelativePath,
    size,
    sha256
  }, projectId);
}

export function normalizeReleaseRecord(value, expectedProjectId = null) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== RELEASE_RECORD_SCHEMA_VERSION) {
    throw releaseRecordError("Release record schema is invalid", "release_record_invalid");
  }
  const record = {
    schemaVersion: RELEASE_RECORD_SCHEMA_VERSION,
    id: requireId(value.id, "id"),
    projectId: requireId(value.projectId, "projectId"),
    buildId: requireString(value.buildId, "buildId"),
    title: requireString(value.title, "title"),
    version: requireString(value.version, "version"),
    target: value.target === WINDOWS_RELEASE_TARGET ? value.target : invalid("Release target is invalid"),
    createdAt: requireIsoDate(value.createdAt),
    artifactRelativePath: normalizeArtifactRelativePath(value.artifactRelativePath),
    size: requireNonNegativeInteger(value.size, "size"),
    sha256: requireSha256(value.sha256)
  };
  if (expectedProjectId && record.projectId !== expectedProjectId) {
    throw releaseRecordError("Release record belongs to another project", "release_project_mismatch");
  }
  return record;
}

export function normalizeArtifactRelativePath(value) {
  if (typeof value !== "string" || value === "" || value.includes("\\") || value.includes("\0") || value.startsWith("/")) {
    throw releaseRecordError("Release artifact path is invalid", "release_artifact_path_invalid");
  }
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || /^[a-zA-Z]:$/.test(part))) {
    throw releaseRecordError("Release artifact path is invalid", "release_artifact_path_invalid");
  }
  return parts.join("/");
}

function requireId(value, label) {
  const result = requireString(value, label);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(result)) {
    throw releaseRecordError(`Release ${label} is invalid`, "release_record_invalid");
  }
  return result;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw releaseRecordError(`Release ${label} is required`, "release_record_invalid");
  }
  return value;
}

function requireIsoDate(value) {
  const result = requireString(value, "createdAt");
  if (Number.isNaN(Date.parse(result))) throw releaseRecordError("Release createdAt is invalid", "release_record_invalid");
  return result;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw releaseRecordError(`Release ${label} is invalid`, "release_record_invalid");
  return value;
}

function requireSha256(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw releaseRecordError("Release sha256 is invalid", "release_record_invalid");
  }
  return value;
}

function invalid(message) {
  throw releaseRecordError(message, "release_record_invalid");
}

function releaseRecordError(message, code) {
  const error = new Error(message);
  error.name = "ReleaseRecordError";
  error.code = code;
  return error;
}
