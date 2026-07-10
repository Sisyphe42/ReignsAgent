import { join } from "node:path";

export function isAllowedAppUrl(candidate, allowedOrigin) {
  try {
    return new URL(candidate).origin === allowedOrigin;
  } catch {
    return false;
  }
}

export function desktopBuildOutputDir(documentsPath) {
  return join(documentsPath, "ReignsAgent", "Builds");
}
