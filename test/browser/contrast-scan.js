// WCAG 2.x AA text contrast scan, run inside the page with page.evaluate(scanContrast, options).
// It must stay self-contained: Playwright serializes the function source into the page.
export function scanContrast(options = {}) {
  // `root` limits the scan to one region. `composite` blends translucent backgrounds onto the first
  // opaque one below them; it is opt-in because the full-panel scan was tuned without it.
  const { root = ".app-shell", composite = false } = typeof options === "string" ? { root: options } : options ?? {};
  const parse = (value) => {
    const rgb = value.match(/rgba?\(([^)]+)\)/);
    if (rgb) {
      const [r, g, b, a = 1] = rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    }
    const srgb = value.match(/color\(srgb ([^)]+)\)/);
    if (srgb) {
      const [r, g, b, a = 1] = srgb[1].split(/[ /]+/).filter(Boolean).map(Number);
      return { r: r * 255, g: g * 255, b: b * 255, a };
    }
    return null;
  };
  const luminance = ({ r, g, b }) => {
    const channel = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  // Translucent layers between the text and the first opaque background are blended onto it, so a
  // dark 82% chip on cream paper is measured as the dark chip it looks like, not as the paper.
  const over = (base, layers) => layers.reduceRight((under, layer) => ({
    r: layer.r * layer.a + under.r * (1 - layer.a),
    g: layer.g * layer.a + under.g * (1 - layer.a),
    b: layer.b * layer.a + under.b * (1 - layer.a),
    a: 1
  }), base);
  const backgroundOf = (element) => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const color = parse(style.backgroundColor);
      if (color && color.a > 0.9) return over(color, layers);
      if (style.backgroundImage && style.backgroundImage !== "none") return null;
      const after = getComputedStyle(node, "::after");
      const paper = parse(after.backgroundColor);
      if (paper && paper.a > 0.9 && after.content !== "none") return over(paper, layers);
      if (composite && color && color.a > 0.05) layers.push(color);
    }
    return over(parse(getComputedStyle(document.body).backgroundColor), layers);
  };
  const failures = [];
  // Form controls show their value (or placeholder) instead of a text node: measure them too.
  for (const control of document.querySelectorAll(`${root} :is(input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]), select, textarea)`)) {
    const rect = control.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = getComputedStyle(control);
    if (style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    const foreground = parse(style.color);
    const background = backgroundOf(control);
    if (!foreground || !background) continue;
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    const ratio = (light + 0.05) / (dark + 0.05);
    if (ratio < 4.5) failures.push(`${ratio.toFixed(2)} ${control.tagName.toLowerCase()}.${[...control.classList].join(".")} value "${String(control.value ?? "").slice(0, 24)}"`);
  }
  for (const element of document.querySelectorAll(`${root} *:not(.ai-ambient *)`)) {
    if (![...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || Number(style.opacity) === 0 || element.closest("[aria-hidden='true']")) continue;
    const foreground = parse(style.color);
    const background = backgroundOf(element);
    if (!foreground || !background) continue;
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    const ratio = (light + 0.05) / (dark + 0.05);
    if (ratio < 4.5) failures.push(`${ratio.toFixed(2)} ${element.tagName.toLowerCase()}.${[...element.classList].join(".")} "${element.textContent.trim().slice(0, 32)}"`);
  }
  return [...new Set(failures)];
}
