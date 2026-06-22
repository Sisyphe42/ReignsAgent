/**
 * ReignsAgent swipe input — dependency-free, progressive enhancement.
 *
 * Provides the signature Reigns left/right interaction across all player
 * surfaces (dev preview, standalone deployable, dashboard preview):
 *   - Keyboard: ArrowLeft/ArrowRight and A/D when a session is active.
 *   - Pointer drag: grab the card, drag it, release past a threshold to commit.
 *   - Touch: pointer events cover touch on modern browsers; touchstart/move/end
 *     is bound as a fallback.
 *   - Click buttons remain the always-available fallback (owned by the host).
 *
 * The host owns the authoritative disabled/game-over state: attachSwipe never
 * fires a swipe while `canSwipe()` returns false, and the buttons stay the
 * single source of truth for availability.
 *
 * This module performs no game logic and holds no card content; it only turns
 * a user gesture into a directional callback. It is pure interaction glue.
 */

const SWIPE_THRESHOLD = 0.28; // fraction of card width to commit
const MAX_TILT = 14; // deg of visual tilt at full drag

export function attachSwipe(options = {}) {
  const element = options.element;
  if (!element || typeof element.addEventListener !== "function") {
    throw new Error("attachSwipe requires an element");
  }
  if (typeof options.onSwipe !== "function") {
    throw new Error("attachSwipe requires an onSwipe(direction) callback");
  }

  const canSwipe = typeof options.canSwipe === "function" ? options.canSwipe : () => true;
  const enabledKeys = options.keys !== false;
  const reducedMotion = typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let dragging = false;
  let startX = 0;
  let currentX = 0;
  let pointerId = null;

  const onKey = (event) => {
    if (!enabledKeys || !canSwipe()) {
      return;
    }
    const key = event.key;
    if (key === "ArrowLeft" || key === "a" || key === "A") {
      event.preventDefault();
      options.onSwipe("left");
    } else if (key === "ArrowRight" || key === "d" || key === "D") {
      event.preventDefault();
      options.onSwipe("right");
    }
  };

  const onPointerDown = (event) => {
    if (!canSwipe() || dragging) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    dragging = true;
    pointerId = event.pointerId;
    startX = event.clientX;
    currentX = event.clientX;
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      // setPointerCapture can throw if the pointer is already released; ignore.
    }
    element.classList.add("swiping");
  };

  const onPointerMove = (event) => {
    if (!dragging || event.pointerId !== pointerId) {
      return;
    }
    currentX = event.clientX;
    applyDragVisuals(reducedMotion);
  };

  const onPointerUp = (event) => {
    if (!dragging || event.pointerId !== pointerId) {
      return;
    }
    finishDrag();
  };

  // Touch fallback for browsers without reliable pointer events on touch.
  const onTouchStart = (event) => {
    if (!canSwipe() || dragging || event.touches.length !== 1) {
      return;
    }
    dragging = true;
    startX = event.touches[0].clientX;
    currentX = startX;
    element.classList.add("swiping");
  };

  const onTouchMove = (event) => {
    if (!dragging || event.touches.length !== 1) {
      return;
    }
    currentX = event.touches[0].clientX;
    applyDragVisuals(reducedMotion);
  };

  const onTouchEnd = () => {
    if (!dragging) {
      return;
    }
    finishDrag();
  };

  function applyDragVisuals(noMotion) {
    if (noMotion) {
      return;
    }
    const width = element.offsetWidth || 1;
    const delta = Math.max(-width, Math.min(width, currentX - startX));
    const fraction = delta / width;
    const tilt = fraction * MAX_TILT;
    element.style.transform = `translateX(${delta}px) rotate(${tilt}deg)`;
    element.dataset.swipeHint = fraction <= -SWIPE_THRESHOLD ? "left" : fraction >= SWIPE_THRESHOLD ? "right" : "";
  }

  function resetVisuals() {
    element.style.transform = "";
    delete element.dataset.swipeHint;
    element.classList.remove("swiping");
  }

  function finishDrag() {
    const width = element.offsetWidth || 1;
    const delta = currentX - startX;
    const fraction = delta / width;
    dragging = false;
    pointerId = null;
    resetVisuals();

    if (Math.abs(fraction) >= SWIPE_THRESHOLD && canSwipe()) {
      options.onSwipe(fraction < 0 ? "left" : "right");
    }
  }

  if (enabledKeys) {
    window.addEventListener("keydown", onKey);
  }
  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);
  element.addEventListener("touchstart", onTouchStart, { passive: true });
  element.addEventListener("touchmove", onTouchMove, { passive: true });
  element.addEventListener("touchend", onTouchEnd);

  return function detach() {
    if (enabledKeys) {
      window.removeEventListener("keydown", onKey);
    }
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerUp);
    element.removeEventListener("touchstart", onTouchStart);
    element.removeEventListener("touchmove", onTouchMove);
    element.removeEventListener("touchend", onTouchEnd);
    resetVisuals();
  };
}
