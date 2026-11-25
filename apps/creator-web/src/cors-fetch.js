import { backendError } from "./backend.js";

/**
 * corsFetch is the Hosted Creator's endpoint fetch (page and workers): it refuses insecure
 * endpoints from an HTTPS page and turns opaque network failures into an actionable CORS hint.
 */
export async function corsFetch(input, init) {
  const origin = globalThis.location;
  const url = new URL(typeof input === "string" ? input : input.url, origin.href);
  if (origin.protocol === "https:" && url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw backendError("HTTPS Creator cannot call an insecure AI endpoint. Use HTTPS or localhost.", "mixed_content_blocked");
  }
  try {
    return await fetch(input, init);
  } catch {
    throw backendError(`The AI endpoint could not be reached. Confirm that it allows CORS for ${origin.origin} and permits Authorization and Content-Type headers.`, "cors_or_network_error");
  }
}
