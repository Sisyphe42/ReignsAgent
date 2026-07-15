export const DEFAULT_SKIN = "github-light";

export const SKIN_ALIASES = Object.freeze({ workbench: "classic" });

export const SKINS = Object.freeze([
  skin("github-light", "Github Light", "Clean repository daylight", "#f6f8fa", "#0969da", {
    bg: "#f6f8fa", surface: "#ffffff", surface2: "#f6f8fa", surface3: "#eaeef2", ink: "#24292f",
    muted: "#57606a", border: "#d0d7de", accent: "#0969da", accent2: "#8250df", danger: "#cf222e",
    ok: "#1a7f37", buttonInk: "#ffffff", radius: "6px", shadow: "rgba(27, 31, 36, 0.12)", colorScheme: "light"
  }),
  skin("catppuccin-latte", "Catppuccin Latte", "Soft café pastels", "#eff1f5", "#8839ef", {
    bg: "#eff1f5", surface: "#fafafa", surface2: "#e6e9ef", surface3: "#dce0e8", ink: "#4c4f69",
    muted: "#6c6f85", border: "#ccd0da", accent: "#8839ef", accent2: "#ea76cb", danger: "#d20f39",
    ok: "#179299", buttonInk: "#ffffff", radius: "8px", shadow: "rgba(76, 79, 105, 0.12)", colorScheme: "light"
  }),
  skin("classic", "Classic", "Candlelit court", "#10110f", "#d8a83a", {
    bg: "#10110f", surface: "#171915", surface2: "#20241d", surface3: "#292e25", ink: "#f1eee4",
    muted: "#a5a091", border: "#3b4037", accent: "#d8a83a", accent2: "#53b6a5", danger: "#e06b5f",
    ok: "#7ccf8a", buttonInk: "#17130a", radius: "6px", shadow: "rgba(4, 6, 3, 0.36)", colorScheme: "dark"
  }),
  skin("famicom", "Famicom", "8-bit family console", "#efe4cc", "#b52222", {
    bg: "#efe4cc", surface: "#f8efd9", surface2: "#fff8e8", surface3: "#e8dac2", ink: "#211f1c",
    muted: "#6d6256", border: "#24211d", accent: "#b52222", accent2: "#275c9a", danger: "#b52222",
    ok: "#1f8b58", buttonInk: "#fff8e8", radius: "0px", shadow: "rgba(36, 33, 29, 0.24)", colorScheme: "light"
  }),
  skin("phantom", "Phantom", "Noir cut-paper dossier", "#09090a", "#d71920", {
    bg: "#09090a", surface: "#151515", surface2: "#f4f0e8", surface3: "#d71920", ink: "#f7f2e9",
    muted: "#c8c1b5", border: "#f7f2e9", accent: "#d71920", accent2: "#f4f0e8", danger: "#d71920",
    ok: "#00a66a", buttonInk: "#f7f2e9", radius: "0px", shadow: "rgba(215, 25, 32, 0.34)", colorScheme: "dark"
  }),
  skin("arcade", "Arcade", "Neon cabinet glow", "#15111c", "#ffd34f", {
    bg: "#15111c", surface: "#211a2e", surface2: "#302442", surface3: "#3b2b51", ink: "#fff2c9",
    muted: "#c6b8d8", border: "#654f83", accent: "#ffd34f", accent2: "#6fe6c4", danger: "#ff6f9f",
    ok: "#94ef68", buttonInk: "#17111f", radius: "4px", shadow: "rgba(7, 2, 15, 0.42)", colorScheme: "dark"
  }),
  skin("terminal", "Terminal", "Green-screen operator", "#07100c", "#68ff95", {
    bg: "#07100c", surface: "#0c1712", surface2: "#12231a", surface3: "#183021", ink: "#daf8e5",
    muted: "#91b89d", border: "#28543a", accent: "#68ff95", accent2: "#78c6ff", danger: "#ff7777",
    ok: "#68ff95", buttonInk: "#06100a", radius: "2px", shadow: "rgba(0, 7, 3, 0.44)", colorScheme: "dark"
  })
]);

const SKIN_BY_ID = new Map(SKINS.map((entry) => [entry.id, entry]));

export function resolveSkinId(value) {
  const normalized = SKIN_ALIASES[value] ?? value;
  return SKIN_BY_ID.has(normalized) ? normalized : null;
}

export function getSkin(value) {
  return SKIN_BY_ID.get(resolveSkinId(value) ?? DEFAULT_SKIN);
}

export function applySkinTheme(root, value) {
  const selected = getSkin(value);
  const tokens = selected.tokens;
  root.dataset.skin = selected.id;
  const variables = {
    "--bg": tokens.bg,
    "--surface": tokens.surface,
    "--surface-2": tokens.surface2,
    "--surface-3": tokens.surface3,
    "--panel": tokens.surface,
    "--panel-raised": tokens.surface2,
    "--ink": tokens.ink,
    "--muted": tokens.muted,
    "--border": tokens.border,
    "--accent": tokens.accent,
    "--accent-2": tokens.accent2,
    "--danger": tokens.danger,
    "--ok": tokens.ok,
    "--decision-left": tokens.danger,
    "--decision-right": tokens.ok,
    "--button-ink": tokens.buttonInk,
    "--radius": tokens.radius,
    "--shadow": tokens.shadow,
    "--player-shadow": `0 28px 80px ${tokens.shadow}`
  };
  for (const [name, token] of Object.entries(variables)) root.style.setProperty(name, token);
  root.style.colorScheme = tokens.colorScheme;
  return selected;
}

function skin(id, label, description, swatchBackground, swatchAccent, tokens) {
  return Object.freeze({ id, label, description, swatch: Object.freeze([swatchBackground, swatchAccent]), tokens: Object.freeze(tokens) });
}
