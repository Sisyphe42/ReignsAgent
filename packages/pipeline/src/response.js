export async function readBoundedResponseBytes(response, { maxBytes, createLimitError }) {
  assertDeclaredLength(response, maxBytes, createLimitError);
  const body = response?.body;
  if (typeof body?.getReader === "function") {
    return readStream(body.getReader(), maxBytes, createLimitError);
  }

  let bytes;
  if (typeof response?.arrayBuffer === "function") {
    bytes = new Uint8Array(await response.arrayBuffer());
  } else if (typeof response?.text === "function") {
    bytes = new TextEncoder().encode(await response.text());
  } else {
    bytes = new Uint8Array();
  }
  assertSize(bytes.byteLength, maxBytes, createLimitError);
  return bytes;
}

export async function readBoundedResponseText(response, options) {
  return new TextDecoder().decode(await readBoundedResponseBytes(response, options));
}

async function readStream(reader, maxBytes, createLimitError) {
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value ?? []);
      size += chunk.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw createLimitError();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function assertDeclaredLength(response, maxBytes, createLimitError) {
  const value = response?.headers?.get?.("content-length");
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return;
  assertSize(Number(value), maxBytes, createLimitError);
}

function assertSize(size, maxBytes, createLimitError) {
  if (size > maxBytes) throw createLimitError();
}
