# Adaptive card artwork display

## Goal

Make square card-art slots present landscape, portrait, and square images well without modifying or manually cropping source assets, while giving creators simple per-asset display and focal-point controls that survive every Creator and Player build path.

## Background

- Content assets currently accept arbitrary image dimensions, but Creator and Player surfaces render them with `object-fit: contain`, which leaves conspicuous empty space for extreme aspect ratios.
- Shared/Hosted Player, Standalone Player, and Creator Preview are separate presentation surfaces and must consume one authored display contract.
- Existing bundles have no display metadata and must remain valid without migration.

## Requirements

- Keep the existing 1:1 artwork slot and original asset bytes, format, dimensions, and URI unchanged.
- Store optional display settings at `asset.metadata.display`:
  - `fit`: `adaptive`, `contain`, or `cover`.
  - `focalPoint`: normalized `{ x, y }` coordinates from `0` through `1`.
- Treat missing settings as `adaptive` with `{ x: 0.5, y: 0.5 }`.
- Validate authored display settings while keeping renderers defensive against malformed legacy input.
- Provide a host-neutral asset display mutation with matching local-server and Hosted-browser API behavior.
- Preserve existing metadata, including display settings, when AI image editing replaces an existing asset.
- Add Creator controls for the three fit modes and a nine-position focal-point picker.
- Render `adaptive` as a blurred cover backdrop plus a complete contain foreground; render `contain` and `cover` with their native semantics.
- Apply the same authored behavior to Creator card thumbnails, Developer Preview, Shared/Hosted Player, and Standalone Player.
- Keep AI candidate and comparison images unchanged.
- Do not add an image-processing dependency, freeform cropper, alternate aspect ratio, or generated derivative images.
- Document the authored contract and behavior in `README.md`.

## Acceptance Criteria

- [x] A legacy asset without display metadata validates and renders as centered `adaptive`.
- [x] Landscape, portrait, and square artwork remain inside the existing 1:1 slot without source mutation.
- [x] `adaptive` shows the complete foreground over a filled blurred backdrop.
- [x] `contain` shows the complete image without a backdrop, and `cover` fills the frame around the selected focal point.
- [x] Invalid fit values, malformed focal points, and coordinates outside `0..1` fail content validation.
- [x] Creator mode and focal changes persist through local and Hosted backends, project reload, export, and deployable builds.
- [x] Updating display settings preserves unrelated asset metadata.
- [x] AI redraw/edit of an existing asset preserves its display settings.
- [x] Backdrop images are ignored by assistive technology and failed image loads do not leave broken artwork chrome.
- [x] Unit, integration, Hosted browser, deployable Player build, visible smoke, and `npm run verify` checks pass.
- [x] Changes are committed in reviewable phases on `feature/adaptive-card-art`, pushed, and submitted as a ready PR without merge.
