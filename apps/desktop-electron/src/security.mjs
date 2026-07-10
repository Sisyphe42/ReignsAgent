export function isAllowedAppUrl(candidate, allowedOrigin) {
  try {
    return new URL(candidate).origin === allowedOrigin;
  } catch {
    return false;
  }
}
