import { createHash } from "node:crypto";

export const WINDOWS_RELEASE_PAYLOAD_VERSION = 1;
export const WINDOWS_RELEASE_TARGET = "windows-x64";
export const WINDOWS_RELEASE_FOOTER_MAGIC = Buffer.from("REIGNSAGENTREL1!", "ascii");
export const WINDOWS_RELEASE_FOOTER_SIZE = 72;

export function createWindowsReleasePayload({ projectId, buildId, title, version, entry = "player.html", files }) {
  const normalizedFiles = normalizeFiles(files);
  const dataParts = [];
  let offset = 0;
  const fileTable = normalizedFiles.map(({ path, bytes }) => {
    const item = { path, offset, length: bytes.length, sha256: sha256(bytes) };
    offset += bytes.length;
    dataParts.push(bytes);
    return item;
  });
  const normalizedEntry = normalizeReleasePath(entry);
  if (!fileTable.some((file) => file.path === normalizedEntry)) {
    throw releaseError(`Release entry '${normalizedEntry}' is missing`, "release_entry_missing");
  }
  const manifest = {
    schemaVersion: WINDOWS_RELEASE_PAYLOAD_VERSION,
    target: WINDOWS_RELEASE_TARGET,
    projectId: requireString(projectId, "projectId"),
    buildId: requireString(buildId, "buildId"),
    title: requireString(title, "title"),
    version: requireString(version, "version"),
    entry: normalizedEntry,
    files: fileTable
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
  const fileBytes = Buffer.concat(dataParts);
  const payload = Buffer.concat([manifestBytes, fileBytes]);
  const footer = Buffer.alloc(WINDOWS_RELEASE_FOOTER_SIZE);
  WINDOWS_RELEASE_FOOTER_MAGIC.copy(footer, 0);
  footer.writeUInt32LE(WINDOWS_RELEASE_PAYLOAD_VERSION, 16);
  footer.writeBigUInt64LE(BigInt(manifestBytes.length), 20);
  footer.writeBigUInt64LE(BigInt(fileBytes.length), 28);
  Buffer.from(sha256(payload), "hex").copy(footer, 36);
  footer.writeUInt32LE(WINDOWS_RELEASE_FOOTER_SIZE, 68);
  return { manifest, bytes: Buffer.concat([payload, footer]) };
}

export function appendWindowsReleasePayload(hostBytes, options) {
  const host = toBuffer(hostBytes, "Windows player host");
  if (host.length === 0) throw releaseError("Windows player host is empty", "release_host_empty");
  const payload = createWindowsReleasePayload(options);
  return { ...payload, executable: Buffer.concat([host, payload.bytes]) };
}

export function parseWindowsReleasePayload(executableBytes) {
  const executable = toBuffer(executableBytes, "Windows release executable");
  if (executable.length < WINDOWS_RELEASE_FOOTER_SIZE) {
    throw releaseError("Windows release footer is missing", "release_footer_missing");
  }
  const footerStart = executable.length - WINDOWS_RELEASE_FOOTER_SIZE;
  const footer = executable.subarray(footerStart);
  if (!footer.subarray(0, 16).equals(WINDOWS_RELEASE_FOOTER_MAGIC)) {
    throw releaseError("Windows release footer magic is invalid", "release_footer_invalid");
  }
  if (footer.readUInt32LE(16) !== WINDOWS_RELEASE_PAYLOAD_VERSION || footer.readUInt32LE(68) !== WINDOWS_RELEASE_FOOTER_SIZE) {
    throw releaseError("Windows release payload version is unsupported", "release_schema_unsupported");
  }
  const manifestLength = safeLength(footer.readBigUInt64LE(20), "manifest");
  const filesLength = safeLength(footer.readBigUInt64LE(28), "files");
  const payloadLength = manifestLength + filesLength;
  const payloadStart = footerStart - payloadLength;
  if (!Number.isSafeInteger(payloadLength) || payloadStart < 0) {
    throw releaseError("Windows release payload length is invalid", "release_length_invalid");
  }
  const payload = executable.subarray(payloadStart, footerStart);
  if (sha256(payload) !== footer.subarray(36, 68).toString("hex")) {
    throw releaseError("Windows release payload hash does not match", "release_hash_mismatch");
  }
  let manifest;
  try {
    manifest = JSON.parse(payload.subarray(0, manifestLength).toString("utf8"));
  } catch (error) {
    throw releaseError(`Windows release manifest is invalid: ${error.message}`, "release_manifest_invalid");
  }
  validateManifest(manifest, filesLength);
  const fileRegion = payload.subarray(manifestLength);
  const files = new Map();
  for (const file of manifest.files) {
    const bytes = fileRegion.subarray(file.offset, file.offset + file.length);
    if (sha256(bytes) !== file.sha256) {
      throw releaseError(`Windows release file '${file.path}' hash does not match`, "release_file_hash_mismatch");
    }
    files.set(file.path, Buffer.from(bytes));
  }
  return { manifest, files, payloadStart };
}

export function sanitizeReleaseFilePart(value, fallback = "untitled") {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeFiles(files) {
  const entries = Array.isArray(files)
    ? files
    : files instanceof Map
      ? [...files.entries()]
      : Object.entries(files ?? {});
  if (entries.length === 0) throw releaseError("Windows release contains no files", "release_files_empty");
  const seen = new Set();
  return entries.map(([path, value]) => {
    const normalizedPath = normalizeReleasePath(path);
    if (seen.has(normalizedPath)) throw releaseError(`Duplicate release file '${normalizedPath}'`, "release_file_duplicate");
    seen.add(normalizedPath);
    return { path: normalizedPath, bytes: toBuffer(value, `Release file '${normalizedPath}'`) };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

export function normalizeReleasePath(value) {
  if (typeof value !== "string" || value === "" || value.includes("\\") || value.includes("\0") || value.startsWith("/")) {
    throw releaseError(`Unsafe release path '${String(value)}'`, "release_path_invalid");
  }
  const parts = value.split("/");
  if (parts.some(isUnsafeWindowsPathPart)) {
    throw releaseError(`Unsafe release path '${value}'`, "release_path_invalid");
  }
  return parts.join("/");
}

function isUnsafeWindowsPathPart(part) {
  const stem = part.split(".")[0].toUpperCase();
  return part === "" || part === "." || part === ".." || /[<>:"|?*\u0000-\u001f]/.test(part)
    || /[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);
}

function validateManifest(manifest, filesLength) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || manifest.schemaVersion !== WINDOWS_RELEASE_PAYLOAD_VERSION || manifest.target !== WINDOWS_RELEASE_TARGET
    || !Array.isArray(manifest.files)) {
    throw releaseError("Windows release manifest schema is invalid", "release_manifest_invalid");
  }
  requireString(manifest.projectId, "projectId");
  requireString(manifest.buildId, "buildId");
  requireString(manifest.title, "title");
  requireString(manifest.version, "version");
  const entry = normalizeReleasePath(manifest.entry);
  const seen = new Set();
  let expectedOffset = 0;
  for (const file of manifest.files) {
    const path = normalizeReleasePath(file?.path);
    if (seen.has(path)) throw releaseError(`Duplicate release file '${path}'`, "release_file_duplicate");
    seen.add(path);
    if (file.offset !== expectedOffset || !Number.isSafeInteger(file.length) || file.length < 0) {
      throw releaseError(`Release file '${path}' has invalid bounds`, "release_file_bounds_invalid");
    }
    expectedOffset += file.length;
    requireSha256(file.sha256);
  }
  if (expectedOffset !== filesLength || !seen.has(entry)) {
    throw releaseError("Windows release file table is incomplete", "release_file_bounds_invalid");
  }
}

function safeLength(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw releaseError(`Release ${label} length is too large`, "release_length_invalid");
  return Number(value);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw releaseError(`Release ${label} is required`, "release_field_invalid");
  return value;
}

function requireSha256(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw releaseError("Release sha256 is invalid", "release_field_invalid");
  return value;
}

function toBuffer(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw releaseError(`${label} must be bytes or text`, "release_file_invalid");
}

function releaseError(message, code) {
  const error = new Error(message);
  error.name = "ReleaseError";
  error.code = code;
  return error;
}
