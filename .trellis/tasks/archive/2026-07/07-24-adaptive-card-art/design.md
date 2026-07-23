# Adaptive card artwork display design

## Contract

The Pipeline owns validation and normalization of the optional authored shape:

```json
{
  "metadata": {
    "display": {
      "fit": "adaptive",
      "focalPoint": { "x": 0.5, "y": 0.5 }
    }
  }
}
```

Missing fields normalize at read/render time to `adaptive` and center. Validation only tightens bundles that opt into `metadata.display`, preserving legacy metadata compatibility.

Interface exposes `setAssetDisplay(assetId, display)`. Local and Hosted adapters expose `PATCH /api/editor/assets/:assetId` with `{ display }`; the mutation merges only `metadata.display` and returns the updated asset plus validation projections.

## Data Flow

Creator control -> backend adapter -> Interface editor -> Pipeline bundle validation -> Workspace persistence -> build content -> Player display normalizer -> artwork frame.

AI image replacement merges prior metadata with new MIME/hash metadata before `upsertAsset`, so display choices survive a redraw.

## Rendering

- Creator gains a card-specific `CardArtwork` wrapper; generic `ProjectAssetImage` remains unchanged for AI results and comparison views.
- All card surfaces use a 1:1 overflow-hidden frame and normalized CSS variables for focal position.
- `adaptive`: an `aria-hidden` duplicate uses `cover`, blur, and a small scale; the foreground uses `contain`.
- `contain`: backdrop hidden, foreground contained with existing surface padding.
- `cover`: backdrop hidden, foreground covers the frame without contain padding.
- Plain HTML Players implement the same DOM/data attributes and a defensive display normalizer. Shared Player remains the source for Hosted `play.html`.

## Compatibility and Failure Behavior

- No bundle migration or schema-version bump is required because the field is optional and assets already preserve metadata.
- Unknown/malformed runtime settings fall back to the default without crashing, even though normal import/build validation rejects them.
- Missing image resources hide the artwork frame in Players; Creator shows its existing placeholder.
- Source assets are never transformed, and deployable Player boundaries remain free of AI or image-processing code.

## Rollback

The feature is additive. Reverting renderer and editor/API changes leaves optional display metadata inert and preserves all source assets.
