export const DEFAULT_CARD_ARTWORK_DISPLAY = Object.freeze({
  fit: "adaptive",
  focalPoint: Object.freeze({ x: 0.5, y: 0.5 })
});

const CARD_ARTWORK_FITS = new Set(["adaptive", "contain", "cover"]);

export function normalizeCardArtworkDisplay(asset) {
  const display = plainRecord(asset?.metadata?.display) ? asset.metadata.display : {};
  const focalPoint = plainRecord(display.focalPoint) ? display.focalPoint : {};
  return {
    fit: CARD_ARTWORK_FITS.has(display.fit) ? display.fit : DEFAULT_CARD_ARTWORK_DISPLAY.fit,
    focalPoint: {
      x: validCoordinate(focalPoint.x) ? focalPoint.x : DEFAULT_CARD_ARTWORK_DISPLAY.focalPoint.x,
      y: validCoordinate(focalPoint.y) ? focalPoint.y : DEFAULT_CARD_ARTWORK_DISPLAY.focalPoint.y
    }
  };
}

export function cardArtworkStyle(asset) {
  const display = normalizeCardArtworkDisplay(asset);
  return {
    display,
    style: {
      "--card-art-focus-x": `${display.focalPoint.x * 100}%`,
      "--card-art-focus-y": `${display.focalPoint.y * 100}%`
    }
  };
}

export function applyCardArtworkDisplay(frame, asset) {
  const normalized = cardArtworkStyle(asset);
  frame.dataset.fit = normalized.display.fit;
  frame.style.setProperty("--card-art-focus-x", normalized.style["--card-art-focus-x"]);
  frame.style.setProperty("--card-art-focus-y", normalized.style["--card-art-focus-y"]);
  return normalized.display;
}

function validCoordinate(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function plainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
