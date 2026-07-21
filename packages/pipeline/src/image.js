const IMAGE_PROTOCOLS = new Set(["openai_images", "gemini_interactions", "stability_v2", "midjourney_proxy"]);
const IMAGE_OPERATIONS = new Set(["generate", "edit", "inpaint", "outpaint"]);
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const IMAGE_FORMATS = new Set(["png", "jpeg", "webp"]);
const IMAGE_ROUTE_MODES = new Set(["auto", "api_root", "full_url"]);
const MAX_OUTPUTS = 4;
const MIDJOURNEY_POLL_INTERVAL_MS = 1500;
const MIDJOURNEY_MAX_POLLS = 200;

export class ImagePipelineError extends Error {
  constructor(message, code = "image_pipeline_error") {
    super(message);
    this.name = "ImagePipelineError";
    this.code = code;
  }
}

const CAPABILITIES = Object.freeze({
  openai_images: Object.freeze({
    protocol: "openai_images",
    operations: ["generate", "edit", "inpaint", "outpaint"],
    inputMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    maxInputImages: 16,
    maxInputBytes: 50 * 1024 * 1024,
    generateWithReferences: false,
    supportsMask: true,
    outputFormats: ["png", "jpeg", "webp"],
    maxOutputs: 4,
    parameters: ["size", "quality", "background", "inputFidelity", "outpaint"]
  }),
  gemini_interactions: Object.freeze({
    protocol: "gemini_interactions",
    operations: ["generate", "edit", "inpaint", "outpaint"],
    inputMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    maxInputImages: 14,
    maxInputBytes: 50 * 1024 * 1024,
    generateWithReferences: true,
    supportsMask: false,
    outputFormats: ["png", "jpeg"],
    maxOutputs: 1,
    parameters: ["aspectRatio", "imageSize", "thinkingLevel"]
  }),
  stability_v2: Object.freeze({
    protocol: "stability_v2",
    operations: ["generate", "edit", "inpaint", "outpaint"],
    inputMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    maxInputImages: 1,
    maxInputBytes: 50 * 1024 * 1024,
    generateWithReferences: false,
    supportsMask: true,
    outputFormats: ["png", "jpeg", "webp"],
    maxOutputs: 1,
    parameters: ["negativePrompt", "aspectRatio", "seed", "stylePreset", "creativity", "outpaint"]
  }),
  midjourney_proxy: Object.freeze({
    protocol: "midjourney_proxy",
    operations: ["generate", "edit"],
    inputMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    maxInputImages: 10,
    maxInputBytes: 50 * 1024 * 1024,
    generateWithReferences: false,
    supportsMask: false,
    outputFormats: ["png", "jpeg", "webp"],
    maxOutputs: 1,
    parameters: ["negativePrompt", "aspectRatio"]
  })
});

export function getImageEndpointCapabilities(config = {}) {
  const normalized = normalizeImageEndpointConfig(config);
  const base = CAPABILITIES[normalized.protocol];
  const declared = Array.isArray(config.capabilities)
    ? new Set(config.capabilities.filter((entry) => IMAGE_OPERATIONS.has(entry)))
    : null;
  return {
    ...base,
    operations: declared ? base.operations.filter((operation) => declared.has(operation)) : [...base.operations],
    inputMimeTypes: [...base.inputMimeTypes],
    outputFormats: [...base.outputFormats],
    parameters: [...base.parameters]
  };
}

export function normalizeImageEndpointConfig(config = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new ImagePipelineError("Image endpoint config must be an object", "image_config_invalid");
  }
  const protocol = normalizeString(config.protocol) || "openai_images";
  if (!IMAGE_PROTOCOLS.has(protocol)) {
    throw new ImagePipelineError(`Unsupported image endpoint protocol '${protocol}'`, "image_protocol_unsupported");
  }
  const routeMode = normalizeString(config.routeMode) || "auto";
  if (!IMAGE_ROUTE_MODES.has(routeMode)) {
    throw new ImagePipelineError(`Unsupported image route mode '${routeMode}'`, "image_route_mode_unsupported");
  }
  const credentialMode = config.credentialMode === "dedicated" ? "dedicated" : "inherit_text";
  return {
    protocol,
    endpoint: normalizeString(config.endpoint) || "",
    routeMode,
    modelId: normalizeString(config.modelId) || "",
    credentialMode,
    variant: normalizeString(config.variant) || "core",
    capabilities: Array.isArray(config.capabilities) ? [...config.capabilities] : undefined,
    defaults: isRecord(config.defaults) ? { ...config.defaults } : {}
  };
}

export function validateImageEndpointConfig({ config } = {}) {
  const normalized = normalizeImageEndpointConfig(config);
  if (!normalized.endpoint || !normalized.modelId) {
    throw new ImagePipelineError("Image endpoint requires endpoint and modelId", "image_config_required");
  }
  let endpointUrl;
  try { endpointUrl = new URL(normalized.endpoint); }
  catch { throw new ImagePipelineError("Image endpoint must be an absolute HTTP(S) URL", "image_endpoint_url_invalid"); }
  if (!["http:", "https:"].includes(endpointUrl.protocol)) {
    throw new ImagePipelineError("Image endpoint must use HTTP or HTTPS", "image_endpoint_url_invalid");
  }
  return {
    valid: true,
    config: redactImageEndpointConfig(normalized),
    capabilities: getImageEndpointCapabilities(normalized),
    routes: Object.fromEntries(Object.entries(imageRoutes(normalized)).map(([operation, url]) => [operation, redactEndpointUrl(url)]))
  };
}

export function normalizeImageOperationRequest(request = {}, capabilities = null) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new ImagePipelineError("Image operation request must be an object", "image_request_invalid");
  }
  const operation = normalizeString(request.operation) || "generate";
  if (!IMAGE_OPERATIONS.has(operation)) {
    throw new ImagePipelineError(`Unsupported image operation '${operation}'`, "image_operation_unsupported");
  }
  if (capabilities && !capabilities.operations.includes(operation)) {
    throw new ImagePipelineError(`Image endpoint does not support '${operation}'`, "image_capability_unsupported");
  }
  const prompt = normalizeString(request.prompt);
  if (!prompt) throw new ImagePipelineError("Image prompt is required", "image_prompt_required");
  const count = clampInteger(request.output?.count ?? request.count ?? 1, 1, capabilities?.maxOutputs ?? MAX_OUTPUTS);
  const format = normalizeImageFormat(request.output?.format ?? request.format ?? "png");
  if (capabilities && !capabilities.outputFormats.includes(format)) {
    throw new ImagePipelineError(`Image endpoint does not support '${format}' output`, "image_capability_unsupported");
  }
  return {
    operation,
    prompt,
    negativePrompt: normalizeString(request.negativePrompt) || "",
    targetCardId: normalizeString(request.targetCardId),
    targetAssetId: normalizeString(request.targetAssetId),
    references: normalizeInputRefs(request.references),
    mask: normalizeString(request.mask),
    output: {
      count,
      format,
      size: normalizeString(request.output?.size),
      aspectRatio: normalizeString(request.output?.aspectRatio),
      imageSize: normalizeString(request.output?.imageSize),
      quality: normalizeString(request.output?.quality),
      background: normalizeString(request.output?.background)
    },
    outpaint: normalizeOutpaint(request.outpaint),
    providerOptions: isRecord(request.providerOptions) ? { ...request.providerOptions } : {}
  };
}

export async function executeImageOperation({
  config,
  credentials = {},
  request,
  inputs = [],
  fetchImpl = globalThis.fetch,
  signal
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new ImagePipelineError("Image endpoint execution requires fetch", "image_fetch_unavailable");
  }
  const normalizedConfig = normalizeImageEndpointConfig(config);
  const capabilities = getImageEndpointCapabilities(normalizedConfig);
  const normalizedRequest = normalizeImageOperationRequest(request, capabilities);
  if (!normalizedConfig.endpoint || !normalizedConfig.modelId) {
    throw new ImagePipelineError("Image endpoint requires endpoint and modelId", "image_config_required");
  }
  const normalizedInputs = inputs.map(normalizeBinaryInput);
  validateInputs(normalizedRequest, normalizedInputs, capabilities);
  const apiKey = normalizeString(credentials.apiKey) || "";

  let raw;
  if (normalizedConfig.protocol === "openai_images") {
    raw = await callOpenAiImages({ config: normalizedConfig, request: normalizedRequest, inputs: normalizedInputs, apiKey, fetchImpl, signal });
  } else if (normalizedConfig.protocol === "gemini_interactions") {
    raw = await callGeminiImages({ config: normalizedConfig, request: normalizedRequest, inputs: normalizedInputs, apiKey, fetchImpl, signal });
  } else if (normalizedConfig.protocol === "midjourney_proxy") {
    raw = await callMidjourneyProxy({ config: normalizedConfig, request: normalizedRequest, inputs: normalizedInputs, apiKey, fetchImpl, signal });
  } else {
    raw = await callStabilityImages({ config: normalizedConfig, request: normalizedRequest, inputs: normalizedInputs, apiKey, fetchImpl, signal });
  }
  const outputs = await materializeOutputs(raw.outputs, { fetchImpl, signal, defaultFormat: normalizedRequest.output.format });
  if (outputs.length === 0) {
    throw new ImagePipelineError("Image endpoint returned no images", "image_empty_response");
  }
  return {
    schemaVersion: 1,
    operation: normalizedRequest.operation,
    provider: {
      protocol: normalizedConfig.protocol,
      endpoint: redactEndpointUrl(raw.url),
      model: normalizedConfig.modelId
    },
    capabilities,
    request: redactImageRequest(normalizedRequest),
    outputs: outputs.slice(0, normalizedRequest.output.count),
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
    ...(raw.usage ? { usage: raw.usage } : {})
  };
}

export function redactImageEndpointConfig(config = {}) {
  const normalized = normalizeImageEndpointConfig(config);
  return { ...normalized, endpoint: redactEndpointUrl(normalized.endpoint) };
}

async function callOpenAiImages({ config, request, inputs, apiKey, fetchImpl, signal }) {
  const edit = request.operation !== "generate";
  const url = resolveImageUrl(config.endpoint, edit ? "/images/edits" : "/images/generations", config.routeMode);
  const headers = { accept: "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  let body;
  if (!edit) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(compact({
      model: config.modelId,
      prompt: request.prompt,
      n: request.output.count,
      size: request.output.size,
      quality: request.output.quality,
      background: request.output.background,
      output_format: request.output.format
    }));
  } else {
    body = new FormData();
    body.append("model", config.modelId);
    body.append("prompt", request.prompt);
    body.append("n", String(request.output.count));
    if (request.output.size) body.append("size", request.output.size);
    if (request.output.quality) body.append("quality", request.output.quality);
    if (request.output.background) body.append("background", request.output.background);
    body.append("output_format", request.output.format);
    for (const input of inputs.filter((entry) => entry.role !== "mask")) {
      body.append("image[]", toBlob(input), input.name);
    }
    const mask = inputs.find((entry) => entry.role === "mask");
    if (mask) body.append("mask", toBlob(mask), mask.name);
  }
  const response = await providerFetch(fetchImpl, url, { method: "POST", headers, body, signal });
  const payload = await readJsonResponse(response, "OpenAI image");
  const data = Array.isArray(payload.data) ? payload.data : [];
  return {
    url,
    outputs: data.flatMap((entry) => entry?.b64_json
      ? [{ base64: entry.b64_json, mimeType: mimeForFormat(request.output.format) }]
      : entry?.url ? [{ url: entry.url }] : []),
    usage: payload.usage
  };
}

async function callGeminiImages({ config, request, inputs, apiKey, fetchImpl, signal }) {
  const url = resolveImageUrl(config.endpoint, "/interactions", config.routeMode);
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (apiKey) headers["x-goog-api-key"] = apiKey;
  const imageInputs = inputs.map((entry) => ({
    type: "image",
    mime_type: entry.mimeType,
    data: bytesToBase64(entry.bytes)
  }));
  const semanticMask = inputs.some((entry) => entry.role === "mask")
    ? " The final supplied image is a mask: redraw its marked region and keep the remaining source content unchanged."
    : "";
  const outpaintInstruction = request.operation === "outpaint"
    ? ` Extend the source image naturally beyond its current canvas (left ${request.outpaint.left}px, right ${request.outpaint.right}px, top ${request.outpaint.up}px, bottom ${request.outpaint.down}px).`
    : "";
  const body = {
    model: config.modelId,
    input: [{ type: "text", text: `${request.prompt}${semanticMask}${outpaintInstruction}` }, ...imageInputs],
    response_format: compact({
      type: "image",
      mime_type: mimeForFormat(request.output.format),
      aspect_ratio: request.output.aspectRatio,
      image_size: request.output.imageSize
    })
  };
  const response = await providerFetch(fetchImpl, url, { method: "POST", headers, body: JSON.stringify(body), signal });
  const payload = await readJsonResponse(response, "Gemini image");
  return { url, outputs: findGeminiImages(payload), usage: payload.usage_metadata ?? payload.usage };
}

async function callStabilityImages({ config, request, inputs, apiKey, fetchImpl, signal }) {
  const route = request.operation === "generate"
    ? `/stable-image/generate/${config.variant}`
    : request.operation === "outpaint"
      ? "/stable-image/edit/outpaint"
      : "/stable-image/edit/inpaint";
  const url = resolveImageUrl(config.endpoint, route, config.routeMode);
  const headers = { accept: mimeForFormat(request.output.format) };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const body = new FormData();
  body.append("prompt", request.prompt);
  body.append("output_format", request.output.format === "jpeg" ? "jpeg" : request.output.format);
  if (request.negativePrompt) body.append("negative_prompt", request.negativePrompt);
  if (request.output.aspectRatio) body.append("aspect_ratio", request.output.aspectRatio);
  if (request.providerOptions.seed !== undefined) body.append("seed", String(request.providerOptions.seed));
  if (request.providerOptions.stylePreset) body.append("style_preset", String(request.providerOptions.stylePreset));
  if (request.providerOptions.creativity !== undefined) body.append("creativity", String(request.providerOptions.creativity));
  const source = inputs.find((entry) => entry.role !== "mask");
  const mask = inputs.find((entry) => entry.role === "mask");
  if (source) body.append("image", toBlob(source), source.name);
  if (mask) body.append("mask", toBlob(mask), mask.name);
  for (const edge of ["left", "right", "up", "down"]) {
    if (request.outpaint[edge] > 0) body.append(edge, String(request.outpaint[edge]));
  }
  const response = await providerFetch(fetchImpl, url, { method: "POST", headers, body, signal });
  const contentType = response.headers?.get?.("content-type")?.split(";")[0]?.trim() || "";
  if (IMAGE_MIME_TYPES.has(contentType)) {
    return { url, outputs: [{ bytes: new Uint8Array(await response.arrayBuffer()), mimeType: contentType }] };
  }
  const payload = await readJsonResponse(response, "Stability image");
  const candidates = [payload.image, payload.data, ...(Array.isArray(payload.artifacts) ? payload.artifacts.map((entry) => entry?.base64) : [])].filter(Boolean);
  return { url, outputs: candidates.map((base64) => ({ base64, mimeType: mimeForFormat(request.output.format) })), usage: payload.usage };
}

async function callMidjourneyProxy({ config, request, inputs, apiKey, fetchImpl, signal }) {
  const url = resolveImageUrl(config.endpoint, "/mj/submit/imagine", config.routeMode);
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await providerFetch(fetchImpl, url, {
    method: "POST",
    headers,
    body: JSON.stringify(compact({
      prompt: buildMidjourneyPrompt(request),
      botType: normalizeMidjourneyBotType(config.modelId),
      base64Array: inputs.filter((entry) => entry.role !== "mask").map((entry) => `data:${entry.mimeType};base64,${bytesToBase64(entry.bytes)}`)
    })),
    signal
  });
  const submitted = await readJsonResponse(response, "Midjourney submit");
  const immediateOutputs = findMidjourneyImageUrls(submitted).map((imageUrl) => ({ url: imageUrl }));
  if (immediateOutputs.length) return { url, outputs: immediateOutputs };
  if (Number(submitted.code ?? 1) !== 1) {
    throw new ImagePipelineError(normalizeString(submitted.description) || "Midjourney task submission failed", "image_task_failed");
  }
  const taskId = normalizeString(submitted.result ?? submitted.taskId ?? submitted.id);
  if (!taskId) throw new ImagePipelineError("Midjourney endpoint did not return a task id", "image_endpoint_parse_error");
  const taskUrl = resolveMidjourneyTaskUrl(url, taskId);
  for (let attempt = 0; attempt < MIDJOURNEY_MAX_POLLS; attempt += 1) {
    const taskResponse = await providerFetch(fetchImpl, taskUrl, { method: "GET", headers: apiKey ? { accept: "application/json", authorization: `Bearer ${apiKey}` } : { accept: "application/json" }, signal });
    const task = await readJsonResponse(taskResponse, "Midjourney task");
    const status = normalizeString(task.status ?? task.state)?.toUpperCase() || "";
    const outputs = findMidjourneyImageUrls(task).map((imageUrl) => ({ url: imageUrl }));
    if (outputs.length && (!status || ["SUCCESS", "COMPLETED", "DONE"].includes(status))) return { url, outputs };
    if (["FAIL", "FAILURE", "FAILED", "CANCEL", "CANCELLED", "CANCELED"].includes(status)) {
      throw new ImagePipelineError(normalizeString(task.failReason ?? task.description ?? task.error) || "Midjourney task failed", "image_task_failed");
    }
    if (attempt < MIDJOURNEY_MAX_POLLS - 1) await waitForImageTask(MIDJOURNEY_POLL_INTERVAL_MS, signal);
  }
  throw new ImagePipelineError("Midjourney task timed out", "image_task_timeout");
}

async function materializeOutputs(outputs, { fetchImpl, signal, defaultFormat }) {
  const materialized = [];
  for (const [index, output] of outputs.entries()) {
    if (output.url) {
      const response = await providerFetch(fetchImpl, output.url, { method: "GET", signal }, "image_result_fetch_failed");
      const mimeType = response.headers?.get?.("content-type")?.split(";")[0]?.trim() || mimeForFormat(defaultFormat);
      const bytes = new Uint8Array(await response.arrayBuffer());
      materialized.push({ id: `output-${index + 1}`, ...normalizeOutputBytes(bytes, mimeType) });
    } else if (output.base64) {
      materialized.push({ id: `output-${index + 1}`, ...normalizeOutputBytes(base64ToBytes(output.base64), output.mimeType || mimeForFormat(defaultFormat)) });
    } else if (output.bytes) {
      materialized.push({ id: `output-${index + 1}`, ...normalizeOutputBytes(output.bytes, output.mimeType || mimeForFormat(defaultFormat)) });
    }
  }
  return materialized;
}

function normalizeOutputBytes(bytes, mimeType) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const detected = detectImageMime(value);
  const normalizedMime = detected || mimeType;
  if (!IMAGE_MIME_TYPES.has(normalizedMime)) {
    throw new ImagePipelineError(`Unsupported generated image MIME '${normalizedMime || "unknown"}'`, "image_mime_unsupported");
  }
  if (value.byteLength === 0) throw new ImagePipelineError("Generated image is empty", "image_empty_response");
  return { bytes: value, mimeType: normalizedMime, byteLength: value.byteLength };
}

function validateInputs(request, inputs, capabilities) {
  const references = inputs.filter((entry) => entry.role !== "mask");
  const masks = inputs.filter((entry) => entry.role === "mask");
  if (request.operation !== "generate" && references.length === 0) {
    throw new ImagePipelineError(`${request.operation} requires an input image`, "image_input_required");
  }
  if (request.operation === "generate" && references.length > 0 && !capabilities.generateWithReferences) {
    throw new ImagePipelineError("Image endpoint does not support references during generation; use edit instead", "image_capability_unsupported");
  }
  if (references.length > capabilities.maxInputImages) {
    throw new ImagePipelineError(`Image endpoint accepts at most ${capabilities.maxInputImages} input images`, "image_input_limit");
  }
  if (inputs.reduce((total, input) => total + input.bytes.byteLength, 0) > capabilities.maxInputBytes) {
    throw new ImagePipelineError("Image inputs exceed the endpoint byte limit", "image_input_limit");
  }
  if (masks.length > 1 || (masks.length && !capabilities.supportsMask && capabilities.protocol !== "gemini_interactions")) {
    throw new ImagePipelineError("Image endpoint does not support a mask", "image_capability_unsupported");
  }
  if (request.operation === "outpaint" && capabilities.protocol === "openai_images" && masks.length !== 1) {
    throw new ImagePipelineError("OpenAI-compatible outpaint requires a locally padded image and alpha mask", "image_outpaint_mask_required");
  }
  for (const input of inputs) {
    if (!capabilities.inputMimeTypes.includes(input.mimeType)) {
      throw new ImagePipelineError(`Unsupported input MIME '${input.mimeType}'`, "image_mime_unsupported");
    }
  }
}

function normalizeBinaryInput(input, index) {
  if (!input || typeof input !== "object") throw new ImagePipelineError("Image input must be an object", "image_input_invalid");
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes ?? []);
  const mimeType = detectImageMime(bytes) || normalizeString(input.mimeType);
  if (!IMAGE_MIME_TYPES.has(mimeType)) throw new ImagePipelineError(`Unsupported input MIME '${mimeType || "unknown"}'`, "image_mime_unsupported");
  return {
    id: normalizeString(input.id) || `input-${index + 1}`,
    name: normalizeString(input.name) || `input-${index + 1}.${extensionForMime(mimeType)}`,
    role: input.role === "mask" ? "mask" : "reference",
    mimeType,
    bytes
  };
}

function findGeminiImages(payload) {
  const outputs = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.data === "string" && (value.type === "image" || normalizeString(value.mime_type)?.startsWith("image/"))) {
      outputs.push({ base64: value.data, mimeType: value.mime_type || "image/png" });
    }
    if (value.output_image && typeof value.output_image.data === "string") {
      outputs.push({ base64: value.output_image.data, mimeType: value.output_image.mime_type || "image/png" });
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(payload);
  const seen = new Set();
  return outputs.filter((entry) => {
    const key = `${entry.mimeType}:${entry.base64.slice(0, 64)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function providerFetch(fetchImpl, url, init, errorCode = "image_endpoint_network_error") {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    if (error?.name === "AbortError") throw new ImagePipelineError("Image request was cancelled", "image_request_cancelled");
    throw new ImagePipelineError(`Image endpoint request failed: ${error.message}`, errorCode);
  }
  if (!response?.ok) {
    throw new ImagePipelineError(`Image endpoint request failed with status ${response?.status ?? "unknown"}`, "image_endpoint_http_error");
  }
  return response;
}

async function readJsonResponse(response, label) {
  const text = typeof response.text === "function" ? await response.text() : "";
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw new ImagePipelineError(`${label} response was not valid JSON: ${error.message}`, "image_endpoint_parse_error");
  }
}

function resolveImageUrl(endpoint, route, routeMode) {
  const root = normalizeString(endpoint)?.replace(/\/+$/, "");
  if (!root) throw new ImagePipelineError("Image endpoint is required", "image_config_required");
  const normalizedRoute = `/${route.replace(/^\/+/, "")}`;
  let url;
  try { url = new URL(root); }
  catch { throw new ImagePipelineError("Image endpoint must be an absolute HTTP(S) URL", "image_endpoint_url_invalid"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new ImagePipelineError("Image endpoint must use HTTP or HTTPS", "image_endpoint_url_invalid");
  if (routeMode === "full_url") return url.toString();
  if (routeMode === "auto" && url.pathname.replace(/\/+$/, "").toLowerCase().endsWith(normalizedRoute.toLowerCase())) return url.toString();
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${normalizedRoute}`;
  return url.toString();
}

function imageRoutes(config) {
  if (config.protocol === "openai_images") {
    return Object.fromEntries([...IMAGE_OPERATIONS].map((operation) => [operation, resolveImageUrl(config.endpoint, operation === "generate" ? "/images/generations" : "/images/edits", config.routeMode)]));
  }
  if (config.protocol === "gemini_interactions") {
    return Object.fromEntries([...IMAGE_OPERATIONS].map((operation) => [operation, resolveImageUrl(config.endpoint, "/interactions", config.routeMode)]));
  }
  if (config.protocol === "midjourney_proxy") {
    return Object.fromEntries(CAPABILITIES.midjourney_proxy.operations.map((operation) => [operation, resolveImageUrl(config.endpoint, "/mj/submit/imagine", config.routeMode)]));
  }
  return {
    generate: resolveImageUrl(config.endpoint, `/stable-image/generate/${config.variant}`, config.routeMode),
    edit: resolveImageUrl(config.endpoint, "/stable-image/edit/inpaint", config.routeMode),
    inpaint: resolveImageUrl(config.endpoint, "/stable-image/edit/inpaint", config.routeMode),
    outpaint: resolveImageUrl(config.endpoint, "/stable-image/edit/outpaint", config.routeMode)
  };
}

function resolveMidjourneyTaskUrl(submitUrl, taskId) {
  const route = `/mj/task/${encodeURIComponent(taskId)}/fetch`;
  const url = new URL(submitUrl);
  if (!/\/mj\/submit\/imagine\/?$/i.test(url.pathname)) {
    throw new ImagePipelineError("Midjourney submit URL must end with /mj/submit/imagine so task results can be fetched", "image_endpoint_url_invalid");
  }
  url.pathname = url.pathname.replace(/\/mj\/submit\/imagine\/?$/i, route);
  return url.toString();
}

function buildMidjourneyPrompt(request) {
  let prompt = request.prompt;
  if (request.output.aspectRatio && !/(?:^|\s)--ar(?:\s|$)/i.test(prompt)) prompt += ` --ar ${request.output.aspectRatio}`;
  if (request.negativePrompt && !/(?:^|\s)--no(?:\s|$)/i.test(prompt)) prompt += ` --no ${request.negativePrompt}`;
  return prompt;
}

function normalizeMidjourneyBotType(value) {
  const normalized = normalizeString(value) || "MID_JOURNEY";
  if (/^(?:mj|midjourney|mid_journey)$/i.test(normalized)) return "MID_JOURNEY";
  if (/^(?:niji|niji_journey)$/i.test(normalized)) return "NIJI_JOURNEY";
  return normalized;
}

function findMidjourneyImageUrls(payload) {
  const urls = new Set();
  const collect = (value) => {
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) urls.add(value);
      return;
    }
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!isRecord(value)) return;
    for (const key of ["imageUrl", "image_url", "url", "result", "images", "imageUrls", "image_urls", "data"]) {
      if (value[key] !== undefined) collect(value[key]);
    }
  };
  collect(payload);
  return [...urls];
}

function waitForImageTask(ms, signal) {
  if (signal?.aborted) return Promise.reject(new ImagePipelineError("Image request was cancelled", "image_request_cancelled"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new ImagePipelineError("Image request was cancelled", "image_request_cancelled")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function redactImageRequest(request) {
  return {
    ...request,
    references: [...request.references],
    providerOptions: { ...request.providerOptions }
  };
}

function redactEndpointUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/key|token|secret|credential/i.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return String(value ?? "").replace(/([?&][^=]*(?:key|token|secret|credential)[^=]*=)[^&]+/gi, "$1[redacted]");
  }
}

function normalizeInputRefs(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeString).filter(Boolean))];
}

function normalizeOutpaint(value) {
  const record = isRecord(value) ? value : {};
  return Object.fromEntries(["left", "right", "up", "down"].map((key) => [key, clampInteger(record[key] ?? 0, 0, 2000)]));
}

function normalizeImageFormat(value) {
  const normalized = normalizeString(value)?.toLowerCase() === "jpg" ? "jpeg" : normalizeString(value)?.toLowerCase();
  if (!IMAGE_FORMATS.has(normalized)) throw new ImagePipelineError(`Unsupported image format '${normalized || "unknown"}'`, "image_format_unsupported");
  return normalized;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ""));
}

function clampInteger(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : min;
}

function toBlob(input) {
  return new Blob([input.bytes], { type: input.mimeType });
}

function mimeForFormat(format) {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

function extensionForMime(mimeType) {
  return mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const normalized = String(value).replace(/^data:[^;]+;base64,/, "");
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(normalized, "base64"));
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function detectImageMime(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}
