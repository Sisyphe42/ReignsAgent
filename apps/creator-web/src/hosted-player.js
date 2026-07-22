import { DEFAULT_SKIN, SKINS, applySkinTheme, resolveSkinId } from "../../../packages/interface/web/skin-catalog.js";
import { createCreatorBackend } from "./backend.js";
import "./hosted-player.css";

const params = new URLSearchParams(location.search);
const locale = normalizeLocale(params.get("locale") || navigator.language);
const desktopClient = params.get("client") === "desktop";
const copy = locale === "zh-Hans" ? {
  back: "返回创作者工作区", skin: "皮肤", kicker: "浏览器玩家端", description: "当前浏览器项目会在这个独立玩家页面中运行。",
  start: "开始统治", restart: "重新开始", idle: "尚未开始", empty: "没有可用卡牌。", ended: "统治已经结束。", turn: "回合", error: "玩家端无法启动"
} : {
  back: "Back to Creator", skin: "Skin", kicker: "Browser player", description: "The active browser project runs here as a separate player page.",
  start: "Start reign", restart: "Restart reign", idle: "No active reign", empty: "No card available.", ended: "The reign has ended.", turn: "Turn", error: "Player could not start"
};

document.documentElement.lang = locale;
const elements = Object.fromEntries(["back-link", "skin", "player-kicker", "player-title", "player-description", "gauges", "card-art", "card", "card-text", "left", "right", "start", "session-meta", "status"].map((id) => [id, document.getElementById(id)]));
elements["back-link"].textContent = copy.back;
elements["player-kicker"].textContent = copy.kicker;
elements["player-description"].textContent = copy.description;
elements.start.textContent = copy.start;
elements["session-meta"].textContent = copy.idle;
document.querySelector(".player-skin").firstChild.textContent = `${copy.skin} `;

for (const entry of SKINS) elements.skin.add(new Option(entry.label, entry.id));
applySkin(params.get("skin"));
elements.skin.addEventListener("change", () => applySkin(elements.skin.value, "push"));

const backParams = new URLSearchParams({ skin: elements.skin.value, locale });
if (desktopClient) backParams.set("client", "desktop");
elements["back-link"].href = `${import.meta.env.BASE_URL}workbench?${backParams}`;

let backend;
let editor;
let state;
let assetUrls = new Map();

elements.start.addEventListener("click", () => void start());
elements.left.addEventListener("click", () => void swipe("left"));
elements.right.addEventListener("click", () => void swipe("right"));

void initialize();

async function initialize() {
  try {
    backend = await createCreatorBackend();
    editor = await backend.request("/api/editor");
    elements["player-title"].textContent = editor.metadata?.title || "ReignsAgent Player";
    document.title = `${elements["player-title"].textContent} — Player`;
    assetUrls = new Map(await Promise.all((editor.assets ?? []).filter((asset) => asset.cardId && asset.uri).map(async (asset) => [asset.cardId, await backend.assetUrl(asset.uri)])));
  } catch (error) {
    showError(error);
  }
}

async function start() {
  try {
    backend ||= await createCreatorBackend();
    state = await backend.request("/api/play/start", { method: "POST", body: { locale } });
    elements.start.textContent = copy.restart;
    render(state);
  } catch (error) {
    showError(error);
  }
}

async function swipe(direction) {
  if (!state?.sessionId || !state.currentCard || state.gameOver) return;
  try {
    state = await backend.request("/api/play/swipe", { method: "POST", body: { sessionId: state.sessionId, direction } });
    render(state);
  } catch (error) {
    showError(error);
  }
}

function render(next) {
  elements.gauges.replaceChildren(...Object.entries(next.gauges ?? {}).map(([key, gauge]) => {
    const item = document.createElement("div");
    item.className = "player-gauge";
    const value = Number(gauge.value ?? gauge.left ?? 0);
    item.innerHTML = `<span>${escapeHtml(gauge.label || key)}</span><strong>${value}</strong><i><b style="width:${Math.max(0, Math.min(100, value))}%"></b></i>`;
    return item;
  }));

  const card = next.currentCard;
  elements["card-text"].textContent = card?.text ?? (next.gameOver ? copy.ended : copy.empty);
  elements.card.classList.toggle("decision-card--ended", Boolean(next.gameOver));
  const imageUrl = card ? assetUrls.get(card.id) : null;
  elements["card-art"].hidden = !imageUrl;
  if (imageUrl) elements["card-art"].src = imageUrl;
  const left = card?.choices?.find((choice) => choice.id === "left");
  const right = card?.choices?.find((choice) => choice.id === "right");
  elements.left.textContent = left?.label ?? "Left";
  elements.right.textContent = right?.label ?? "Right";
  elements.left.disabled = !card || Boolean(next.gameOver);
  elements.right.disabled = !card || Boolean(next.gameOver);
  elements["session-meta"].textContent = `${copy.turn} ${next.turn ?? 0}`;
  elements.status.textContent = next.gameOver ? copy.ended : "";
}

function applySkin(value, historyMode = "replace") {
  const skin = resolveSkinId(value) ?? DEFAULT_SKIN;
  applySkinTheme(document.documentElement, skin);
  elements.skin.value = skin;
  params.set("skin", skin);
  history[`${historyMode}State`](null, "", `${location.pathname}?${params}`);
}

function showError(error) {
  elements.status.textContent = `${copy.error}: ${error?.message ?? error}`;
  elements.status.className = "player-error";
}

function normalizeLocale(value) {
  return String(value).toLowerCase().startsWith("zh") ? "zh-Hans" : "en";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
}
