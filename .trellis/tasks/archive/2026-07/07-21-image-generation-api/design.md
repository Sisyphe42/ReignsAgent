# Image generation API design

## Architecture

`Creator Web -> Creator backend -> Interface orchestration -> Pipeline image adapter -> provider` produces an `ImageDraftResult`. Provider bytes are staged by the host Workspace. Explicit apply commits the selected draft and then applies an `upsertAsset` patch. Player builds consume only committed asset URIs.

## Contracts

- `ImageEndpointConfig`: protocol, endpoint, route mode, model id, credential mode, declared capability overrides, and provider defaults.
- `ImageEndpointCapabilities`: operations, input MIME/count, mask support, output formats/count, sizes/aspect ratios, and supported optional parameters.
- `ImageOperationRequest`: operation, prompt, optional negative prompt, logical reference/mask ids, target card/asset, output preferences, outpaint edges, and provider options.
- `ImageAssetOutput`: staged id, MIME, byte length, digest, dimensions when known, and preview URL at the host boundary.
- `ImageDraftResult`: draft id, redacted provider summary, capability snapshot, outputs, warnings, and usage metadata.

## Provider Mapping

- OpenAI Images: JSON `/images/generations`; multipart `/images/edits` for edit/inpaint and locally prepared outpaint inputs. Parse `b64_json` or URLs.
- Gemini Interactions: JSON text/image blocks with inline base64 and image response format. Semantic edit and multi-reference support are capability-gated.
- Stability: multipart Stable Image generate/edit/inpaint/outpaint routes. Parse direct image bodies or JSON/base64 responses.

## Storage and API

- Workspace owns `stageActiveProjectAsset`, `readActiveProjectAsset`, `commitActiveProjectAsset`, and `discardActiveProjectAssetDraft` for Node and OPFS.
- Drafts use `assets/.drafts/<draft-id>/`; committed bytes use `assets/generated/<sha256>.<ext>`.
- API routes: validate, stage raw bytes, run, apply, discard, and safe project-asset GET. Hosted implements equivalent routes in-process and exposes object URLs.
- Inputs are referenced by staged/project ids in JSON; large image bytes are not copied through content bundle contracts.

## Compatibility and Safety

- Missing `ai.image` means unconfigured. Dedicated image credentials follow current workspace redaction/export rules; request credentials override stored values.
- Route resolution never silently switches protocols. Returned URLs are fetched immediately and only localized bytes are retained.
- Validate paths, MIME signatures, sizes, operation capability, draft ownership, and active bundle fingerprint before mutation.
- Applying uses immutable files, so bundle undo can remove a binding without destructively rewriting prior bytes.
