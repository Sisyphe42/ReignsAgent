import { attachSwipe } from "/assets/swipe-input.js";

const api = async (path, options = {}) => {
  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok || json?.error) {
    throw new Error(json?.error?.message ?? `Request failed: ${res.status}`);
  }
  return json;
};

const el = (id) => document.getElementById(id);
const requestedLocale = new URLSearchParams(window.location.search).get("locale") || navigator.language || "en";
const setStatus = (node, message, kind = "") => {
  node.textContent = message;
  node.className = `status ${kind ? `status--${kind}` : ""}`;
};

const SAMPLE_URL = "/api/samples/oss-court";
const FACTION_LIST = ["faith", "people", "military", "treasury"];
const PERSIST_KEY = "reigns-agent.editor.v1";
let assetByCard = new Map();
let appliedPresentationVariables = new Set();
let lastEditorState = null;
let lastDiagnosticsSummary = "Not run";
let lastBuildSummary = "Not prepared";

async function refreshEditor() {
  const data = await api("/api/editor");
  lastEditorState = data;
  assetByCard = createAssetMap(data.assets ?? []);
  applyPresentation(data.metadata?.presentation);
  el("meta-title").value = data.metadata?.title ?? "";
  renderCards(data.cards, data.validation);
  const playerReady = data.playerValidation?.valid;
  setStatus(
    el("editor-status"),
    `${data.cards.length} cards · validation ${data.validation.valid ? "ok" : "failed"} · player-ready ${playerReady ? "yes" : "no"}`,
    data.validation.valid ? "ok" : "err"
  );
  renderOverview(data);
  renderStorySummary(data);
  updateRail({ cards: data.cards.length, playerReady, validation: data.validation });
  schedulePersist();
}

function updateRail({ cards, playerReady, validation }) {
  setRail("overview", cards > 0 ? "ready" : "empty", cards > 0);
  setRail("content", cards > 0 ? `${cards} cards` : "empty", cards > 0);
  setRail("story", cards > 0 ? "mapped" : "empty", cards > 0);
  setRail("review", lastDiagnosticsSummary === "Not run" ? "not run" : lastDiagnosticsSummary, lastDiagnosticsSummary !== "Not run" ? true : null);
  setRail("preview", playerReady ? "ready" : "blocked", playerReady);
  setRail("build", lastBuildSummary === "Not prepared" ? "not prepared" : lastBuildSummary.toLowerCase(), lastBuildSummary !== "Not prepared" ? true : null);
  setRail("settings", "ok", true);
}

function setRail(step, text, ok) {
  const node = el(`rail-${step}`);
  if (!node) return;
  node.textContent = text;
  node.dataset.ok = ok === true ? "true" : ok === false ? "false" : "";
}

function setRailDynamic(step, text, ok) {
  setRail(step, text, ok);
}

function switchPanel(panelName) {
  const target = document.querySelector(`[data-panel="${panelName}"]`);
  if (!target) return;

  for (const panel of document.querySelectorAll("[data-panel]")) {
    const active = panel === target;
    panel.hidden = !active;
    panel.classList.toggle("panel--active", active);
  }

  for (const control of document.querySelectorAll("[data-panel-target]")) {
    const active = control.dataset.panelTarget === panelName;
    if (control.classList.contains("rail__step")) {
      control.setAttribute("aria-current", active ? "page" : "false");
    }
  }
}

function renderOverview(data) {
  el("overview-title").textContent = data.metadata?.title || "Untitled";
  el("overview-cards").textContent = String(data.cards.length);
  el("overview-validation").textContent = data.validation.valid ? "Valid" : "Invalid";
  el("overview-validation").dataset.ok = data.validation.valid ? "true" : "false";
  el("overview-player").textContent = data.playerValidation?.valid ? "Ready" : "Blocked";
  el("overview-player").dataset.ok = data.playerValidation?.valid ? "true" : "false";
  el("overview-diagnostics").textContent = lastDiagnosticsSummary;
  el("overview-build").textContent = lastBuildSummary;
}

function renderStorySummary(data) {
  el("story-card-count").textContent = `${data.cards.length} cards`;
  el("story-ending-status").textContent = data.cards.length > 0 ? "Data-authored" : "No content";
  el("story-reachability").textContent = lastDiagnosticsSummary === "Not run" ? "Run review" : lastDiagnosticsSummary;
}

/**
 * Persistence: debounce-save the editor bundle to localStorage after mutations,
 * and offer to restore an in-progress session on load. Restore goes through
 * /api/editor/restore so the server re-validates before applying. The
 * deployable player is unaffected — this is a creator-dashboard convenience.
 */
let persistTimer = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistEditor, 600);
}

async function persistEditor() {
  try {
    const snap = await api("/api/editor/snapshot");
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ savedAt: Date.now(), bundle: snap.bundle }));
  } catch {
    // Persistence is best-effort; ignore storage/network failures silently.
  }
}

async function offerRestore() {
  let raw;
  try {
    raw = localStorage.getItem(PERSIST_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return;
  }
  if (!entry?.bundle?.cards?.length) return;
  setStatus(el("ingest-status"), `Restoring ${entry.bundle.cards.length} cards from saved session…`, "");
  try {
    await api("/api/editor/restore", { method: "POST", body: { bundle: entry.bundle } });
    await refreshEditor();
    setStatus(el("ingest-status"), "Restored saved session", "ok");
  } catch (error) {
    setStatus(el("ingest-status"), `Restore failed: ${error.message}`, "err");
  }
}

/** focusCard scrolls to and flashes a card row so diagnostic warnings can link in. */
function focusCard(cardId) {
  const entry = cardRows.get(cardId);
  if (!entry) return;
  switchPanel("content");
  entry.row.scrollIntoView({ behavior: "smooth", block: "center" });
  entry.row.classList.remove("flash");
  void entry.row.offsetWidth; // restart animation
  entry.row.classList.add("flash");
}

const cardRows = new Map(); // cardId -> { row, expandedCard }

function renderCards(cards, validation) {
  const list = el("card-list");
  const seen = new Set(cards.map((card) => card.id));

  // Remove rows for cards that no longer exist.
  for (const [cardId, entry] of cardRows) {
    if (!seen.has(cardId)) {
      entry.row.remove();
      cardRows.delete(cardId);
    }
  }

  // Create or update rows in order, preserving DOM (and input focus).
  cards.forEach((card, index) => {
    let entry = cardRows.get(card.id);
    if (!entry) {
      entry = { row: buildCardRow(card), expandedCard: null };
      cardRows.set(card.id, entry);
      wireCardRow(entry, card);
    }
    if (entry.row.parentElement !== list || [...list.children][index] !== entry.row) {
      list.insertBefore(entry.row, [...list.children][index] ?? null);
    }
    syncCardRow(entry, card, validationForCard(validation, card));
  });
}

function buildCardRow(card) {
  const row = document.createElement("div");
  row.className = "card-row";
  row.dataset.cardId = card.id;
  row.innerHTML = `
    <div class="card-row__head">
      <div class="card-row__meta">
        <img class="card-row__art" alt="" hidden />
        <span class="card-row__id"></span>
        <span class="card-row__badge" hidden></span>
      </div>
      <div class="card-row__edit">
        <input type="text" data-edit-text />
        <button class="btn" data-save type="button">Save</button>
        <button class="btn" data-delete type="button">✕</button>
      </div>
    </div>
    <div class="card-row__choices"></div>
    <details class="effects">
      <summary>Edit choices</summary>
      <div class="effects__body"></div>
    </details>
  `;
  return row;
}

function wireCardRow(entry, card) {
  const { row } = entry;
  const cardId = card.id;

  row.querySelector("[data-save]").addEventListener("click", async () => {
    const text = row.querySelector("[data-edit-text]").value;
    await api(`/api/editor/cards/${encodeURIComponent(cardId)}`, {
      method: "PUT",
      body: { changes: { text } }
    });
    await refreshEditor();
  });

  row.querySelector("[data-delete]").addEventListener("click", async () => {
    await api(`/api/editor/cards/${encodeURIComponent(cardId)}`, { method: "DELETE" });
    cardRows.delete(cardId);
    await refreshEditor();
  });
}

function syncCardRow(entry, card, cardValidation) {
  const { row } = entry;
  const asset = assetByCard.get(card.id);
  const art = row.querySelector(".card-row__art");
  if (asset) {
    art.src = asset.uri;
    art.hidden = false;
  } else {
    art.removeAttribute("src");
    art.hidden = true;
  }
  row.querySelector(".card-row__id").textContent = card.id;

  // Text input: update only if not focused, to avoid clobbering the caret.
  const textInput = row.querySelector("[data-edit-text]");
  if (document.activeElement !== textInput) {
    textInput.value = card.text ?? "";
  }

  const badge = row.querySelector(".card-row__badge");
  if (cardValidation) {
    badge.hidden = false;
    badge.textContent = cardValidation.valid ? "player-ready" : "invalid";
    badge.className = `card-row__badge badge badge--${cardValidation.valid ? "ok" : "err"}`;
  } else {
    badge.hidden = true;
  }

  const choicesLine = (card.choices ?? []).map((c) => c.id).join(", ");
  row.querySelector(".card-row__choices").textContent = `choices: ${choicesLine}`;

  syncEffectsEditor(entry, card);
}

function validationForCard(validation, card) {
  const messages = validation?.errors ?? [];
  const mine = messages.filter((message) => message.includes(`'${card.id}'`) || message.includes(`Card '${card.id}'`));
  return { valid: mine.length === 0, errors: mine };
}

/**
 * syncEffectsEditor builds (once) and then refreshes a structured per-choice
 * editor inside the card row. Structured fields patch single effects through
 * the granular routes; the advanced JSON textarea replaces the whole effects
 * object through setChoiceEffects. Inputs are never rebuilt while focused, so
 * typing in a field keeps the caret position.
 */
function syncEffectsEditor(entry, card) {
  const body = entry.row.querySelector(".effects__body");

  // Build a choice editor once per choice id; reuse on subsequent syncs.
  const existing = new Map([...body.children].map((node) => [node.dataset.choiceId, node]));
  const seen = new Set();

  for (const choice of card.choices ?? []) {
    seen.add(choice.id);
    let node = existing.get(choice.id);
    if (!node) {
      node = buildChoiceEditor(card.id, choice);
      body.appendChild(node);
    }
    syncChoiceEditor(node, choice);
  }
  for (const [choiceId, node] of existing) {
    if (!seen.has(choiceId)) {
      node.remove();
    }
  }
}

function buildChoiceEditor(cardId, choice) {
  const node = document.createElement("div");
  node.className = "choice-editor";
  node.dataset.choiceId = choice.id;
  node.innerHTML = `
    <div class="choice-editor__head">
      <span class="choice-editor__id"></span>
      <label class="choice-editor__label">label
        <input type="text" data-choice-label />
      </label>
    </div>
    <div class="choice-editor__group">
      <span class="choice-editor__group-title">faction deltas</span>
      <div class="choice-editor__factions" data-factions></div>
    </div>
    <div class="choice-editor__group">
      <span class="choice-editor__group-title">tags</span>
      <div data-tags></div>
      <button type="button" class="btn btn--ghost" data-add-tag>+ tag</button>
    </div>
    <div class="choice-editor__group">
      <span class="choice-editor__group-title">variables</span>
      <div data-variables></div>
      <button type="button" class="btn btn--ghost" data-add-variable>+ variable</button>
    </div>
    <details class="choice-editor__advanced">
      <summary>Advanced JSON</summary>
      <textarea data-effects-json rows="4" spellcheck="false"></textarea>
      <button type="button" class="btn" data-apply-json>Apply JSON</button>
    </details>
  `;

  node.querySelector(".choice-editor__id").textContent = choice.id;

  const cardPath = `/api/editor/cards/${encodeURIComponent(cardId)}`;
  const choicePath = `${cardPath}/choices/${encodeURIComponent(choice.id)}`;

  node.querySelector("[data-choice-label]").addEventListener("change", async (event) => {
    await api(choicePath, { method: "PATCH", body: { label: event.target.value } });
    await refreshEditor();
  });

  const factionsEl = node.querySelector("[data-factions]");
  for (const faction of FACTION_LIST) {
    const field = document.createElement("label");
    field.className = "faction-field";
    field.innerHTML = `<span>${faction}</span><input type="number" data-faction="${faction}" /></label>`;
    const input = field.querySelector("input");
    input.addEventListener("change", async () => {
      const raw = input.value.trim();
      if (raw === "") {
        await api(`${choicePath}/effects/faction/${faction}`, { method: "DELETE" });
      } else {
        const delta = Number(raw);
        if (Number.isFinite(delta)) {
          await api(`${choicePath}/effects/faction/${faction}`, { method: "POST", body: { value: delta } });
        }
      }
      await refreshEditor();
    });
    factionsEl.appendChild(field);
  }

  node.querySelector("[data-add-tag]").addEventListener("click", () => {
    addKeyRow(node.querySelector("[data-tags]"), "tag", "true", async (key, value) => {
      const cleaned = value.trim() === "" || value === "false" ? null : value === "true" ? true : value;
      await applyEffectEntry(choicePath, "tag", key, cleaned);
    });
  });
  node.querySelector("[data-add-variable]").addEventListener("click", () => {
    addKeyRow(node.querySelector("[data-variables]"), "variable", "", async (key, value) => {
      const parsed = parseScalar(value);
      await applyEffectEntry(choicePath, "variable", key, parsed);
    });
  });

  const jsonInput = node.querySelector("[data-effects-json]");
  node.querySelector("[data-apply-json]").addEventListener("click", async () => {
    try {
      const effects = JSON.parse(jsonInput.value);
      await api(choicePath, { method: "PATCH", body: { effects } });
      await refreshEditor();
      setStatus(el("editor-status"), `Effects saved for ${choice.id}`, "ok");
    } catch (error) {
      setStatus(el("editor-status"), error.message, "err");
    }
  });

  return node;
}

function syncChoiceEditor(node, choice) {
  const effects = choice.effects ?? {};
  const labelInput = node.querySelector("[data-choice-label]");
  if (document.activeElement !== labelInput) {
    labelInput.value = choice.label ?? "";
  }

  for (const faction of FACTION_LIST) {
    const input = node.querySelector(`[data-faction="${faction}"]`);
    if (document.activeElement !== input) {
      const delta = effects.factions?.[faction];
      input.value = delta === undefined ? "" : String(delta);
    }
  }

  syncKeyRows(node.querySelector("[data-tags]"), Object.entries(effects.tags ?? {}), "tag");
  syncKeyRows(node.querySelector("[data-variables]"), Object.entries(effects.variables ?? {}), "variable");

  const jsonInput = node.querySelector("[data-effects-json]");
  if (document.activeElement !== jsonInput) {
    jsonInput.value = JSON.stringify(effects, null, 2);
  }
}

function syncKeyRows(container, entries, kind) {
  const existing = [...container.querySelectorAll("[data-key-row]")];
  const keys = entries.map(([key]) => key);
  for (const row of existing) {
    if (!keys.includes(row.dataset.key)) {
      row.remove();
    }
  }
  for (const [key, value] of entries) {
    let row = container.querySelector(`[data-key-row][data-key="${cssEscape(key)}"]`);
    if (!row) {
      row = buildKeyRow(key, kind);
      container.appendChild(row);
    }
    const valueInput = row.querySelector("[data-key-value]");
    if (document.activeElement !== valueInput) {
      valueInput.value = typeof value === "boolean" ? (value ? "true" : "false") : String(value ?? "");
    }
  }
}

function buildKeyRow(key, kind) {
  const row = document.createElement("div");
  row.className = "key-row";
  row.dataset.keyRow = "";
  row.dataset.key = key;
  row.innerHTML = `
    <input type="text" data-key-name value="${escapeAttribute(key)}" />
    <input type="text" data-key-value />
    <button type="button" class="btn btn--ghost" data-key-remove>✕</button>
  `;
  return row;
}

function addKeyRow(container, kind, defaultText, onApply) {
  const row = buildKeyRow("", kind);
  row.querySelector("[data-key-value]").value = defaultText;
  container.appendChild(row);
  const nameInput = row.querySelector("[data-key-name]");
  nameInput.focus();

  const apply = async () => {
    const key = row.querySelector("[data-key-name]").value.trim();
    const value = row.querySelector("[data-key-value]").value;
    if (!key) {
      setStatus(el("editor-status"), `${kind} needs a name`, "err");
      return;
    }
    try {
      await onApply(key, value);
      await refreshEditor();
    } catch (error) {
      setStatus(el("editor-status"), error.message, "err");
    }
  };
  row.querySelector("[data-key-value]").addEventListener("change", apply);
  row.querySelector("[data-key-remove]").addEventListener("click", async () => {
    const key = row.querySelector("[data-key-name]").value.trim();
    if (key) {
      try {
        await onApply(key, null);
        await refreshEditor();
      } catch (error) {
        setStatus(el("editor-status"), error.message, "err");
      }
    } else {
      row.remove();
    }
  });
}

async function applyEffectEntry(choicePath, kind, key, value) {
  if (value === null) {
    await api(`${choicePath}/effects/${kind}/${encodeURIComponent(key)}`, { method: "DELETE" });
  } else {
    await api(`${choicePath}/effects/${kind}/${encodeURIComponent(key)}`, { method: "POST", body: { value } });
  }
}

function parseScalar(text) {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const num = Number(trimmed);
  if (trimmed !== "" && Number.isFinite(num)) return num;
  return trimmed;
}

function cssEscape(value) {
  return CSS?.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\"');
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function createAssetMap(assets) {
  const map = new Map();
  for (const asset of assets) {
    if (asset?.cardId && asset?.uri && !map.has(asset.cardId)) {
      map.set(asset.cardId, asset);
    }
  }
  return map;
}

for (const control of document.querySelectorAll("[data-panel-target]")) {
  control.addEventListener("click", () => switchPanel(control.dataset.panelTarget));
}

async function importContent(content) {
  const result = await api("/api/editor/import", {
    method: "POST",
    body: typeof content === "string" ? { content } : { bundle: content }
  });
  setStatus(el("ingest-status"), `Imported ${result.cardCount} cards`, "ok");
  await refreshEditor();
}

el("load-sample").addEventListener("click", async () => {
  const sample = await api(SAMPLE_URL);
  await importContent(sample);
});
el("ingest-paste").addEventListener("click", () => {
  const text = el("ingest-text").value.trim();
  if (!text) {
    setStatus(el("ingest-status"), "Paste JSON first", "err");
    return;
  }
  importContent(text);
});
el("ingest-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  await importContent(text);
});

el("meta-save").addEventListener("click", async () => {
  await api("/api/editor/metadata", { method: "PATCH", body: { metadata: { title: el("meta-title").value } } });
  setStatus(el("settings-status"), "Title saved", "ok");
  await refreshEditor();
});

el("add-create").addEventListener("click", async () => {
  const id = el("add-id").value.trim();
  const text = el("add-text").value.trim();
  if (!id || !text) {
    setStatus(el("editor-status"), "Card needs id and text", "err");
    return;
  }
  try {
    await api("/api/editor/cards", {
      method: "POST",
      body: {
        card: {
          id, text, weight: 1,
          choices: [
            { id: "left", label: "Left", effects: { factions: { people: -3 } } },
            { id: "right", label: "Right", effects: { factions: { treasury: 3 } } }
          ]
        }
      }
    });
    el("add-id").value = "";
    el("add-text").value = "";
    await refreshEditor();
  } catch (error) {
    setStatus(el("editor-status"), error.message, "err");
  }
});

let playSession = null;
let lastPlayState = null;

function canSwipePlay() {
  return Boolean(playSession) && !lastPlayState?.gameOver && lastPlayState?.currentCard;
}

attachSwipe({
  element: el("play-card"),
  onSwipe: (direction) => swipe(direction),
  canSwipe: canSwipePlay
});

el("play-start").addEventListener("click", async () => {
  try {
    const result = await api("/api/play/start", { method: "POST", body: { locale: requestedLocale } });
    if (result.error) throw new Error(result.error.message);
    playSession = result.sessionId;
    renderPlay(result);
    setStatus(el("play-status"), "Session started", "ok");
  } catch (error) {
    setStatus(el("play-status"), error.message, "err");
  }
});

async function swipe(direction) {
  if (!canSwipePlay()) return;
  try {
    const result = await api("/api/play/swipe", { method: "POST", body: { sessionId: playSession, direction } });
    renderPlay(result);
    if (result.gameOver) {
      setStatus(el("play-status"), `Game over: ${result.gameOver.faction}`, "err");
    }
    el("play-debug").textContent = `Turn ${result.turn ?? 0} · session ${playSession}`;
  } catch (error) {
    setStatus(el("play-status"), error.message, "err");
  }
}

el("swipe-left").addEventListener("click", () => swipe("left"));
el("swipe-right").addEventListener("click", () => swipe("right"));

function renderPlay(state) {
  lastPlayState = state;
  renderGauges(state.gauges ?? {});
  el("play-debug").textContent = state.sessionId
    ? `Turn ${state.turn ?? 0} · session ${state.sessionId}`
    : `Turn ${state.turn ?? 0} · ${state.gameOver ? "ended" : "active"}`;
  const art = el("play-art");
  if (state.currentCard) {
    const asset = assetByCard.get(state.currentCard.id);
    if (asset) {
      art.src = asset.uri;
      art.hidden = false;
    } else {
      art.removeAttribute("src");
      art.hidden = true;
    }
    el("play-text").textContent = state.currentCard.text ?? state.currentCard.id;
    setChoiceButtonLabels(state.currentCard);
    el("swipe-left").disabled = false;
    el("swipe-right").disabled = false;
  } else {
    art.removeAttribute("src");
    art.hidden = true;
    el("play-text").textContent = state.gameOver ? "The reign has ended." : "No card available.";
    resetChoiceButtonLabels();
    el("swipe-left").disabled = true;
    el("swipe-right").disabled = true;
  }
}

function setChoiceButtonLabels(card) {
  const left = card.choices?.find((choice) => choice.id === "left");
  const right = card.choices?.find((choice) => choice.id === "right");
  el("swipe-left").textContent = `◀ ${left?.label ?? "Left"}`;
  el("swipe-right").textContent = `${right?.label ?? "Right"} ▶`;
}

function resetChoiceButtonLabels() {
  el("swipe-left").textContent = "◀ Left";
  el("swipe-right").textContent = "Right ▶";
}

function renderGauges(gauges) {
  const node = el("gauges");
  node.innerHTML = "";
  for (const [name, gauge] of Object.entries(gauges)) {
    const div = document.createElement("div");
    div.className = "gauge";
    div.innerHTML = `
      <div class="gauge__name">${escapeHtml(name)} · ${gauge.value}</div>
      <div class="gauge__bar"><div class="gauge__fill" style="width:${gauge.left}%"></div></div>
    `;
    node.appendChild(div);
  }
}

el("diag-run").addEventListener("click", async () => {
  try {
    const result = await api("/api/diagnostics/run", {
      method: "POST",
      body: {
        cycles: Number(el("diag-cycles").value),
        maxTurns: Number(el("diag-turns").value),
        seed: Number(el("diag-seed").value)
      }
    });
    el("health").hidden = false;
    el("health-score").textContent = result.healthScore;
    el("health-headline").textContent = result.headline;
    lastDiagnosticsSummary = `${result.healthScore}/100`;
    if (lastEditorState) {
      renderOverview(lastEditorState);
      renderStorySummary(lastEditorState);
    }
    const list = el("warnings");
    list.innerHTML = "";
    for (const warning of result.warnings) {
      const li = document.createElement("li");
      li.className = `warning warning--${warning.severity}`;
      const cardIds = warning.details?.cardIds ?? [];
      li.innerHTML = `<span class="warning__code">${escapeHtml(warning.code)}</span> · ${escapeHtml(warning.message)}`;
      if (cardIds.length > 0) {
        li.title = `Jump to ${cardIds.join(", ")}`;
        li.style.cursor = "pointer";
        li.addEventListener("click", () => focusCard(cardIds[0]));
      }
      list.appendChild(li);
    }
    if (result.warnings.length === 0) {
      list.innerHTML = '<li class="warning">No diagnostics warnings.</li>';
    }
    setRailDynamic("review", `${result.healthScore}/100`, result.healthScore >= 70);
  } catch (error) {
    setStatus(el("play-status"), error.message, "err");
  }
});

el("ai-plan").addEventListener("click", async () => {
  try {
    const plan = await api("/api/connector/plan", {
      method: "POST",
      body: {
        config: {
          provider: el("ai-provider").value || "stub",
          theme: el("ai-theme").value || "untitled",
          cardCount: Number(el("ai-count").value) || 8
        }
      }
    });
    el("ai-output").textContent = JSON.stringify(plan, null, 2);
  } catch (error) {
    el("ai-output").textContent = error.message;
  }
});

el("build-prepare").addEventListener("click", async () => {
  try {
    const result = await api("/api/build/prepare", { method: "POST", body: {} });
    el("build-output").textContent = serializeBuild(result.build);
    lastBuildSummary = "Previewed";
    if (lastEditorState) renderOverview(lastEditorState);
    setRailDynamic("build", "previewed", true);
  } catch (error) {
    el("build-output").textContent = error.message;
    setRailDynamic("build", "failed", false);
  }
});

el("build-export").addEventListener("click", async () => {
  try {
    const result = await api("/api/build/export", { method: "POST", body: {} });
    el("build-output").textContent = `Exported → ${result.outputPath}\nbuildId: ${result.buildId}`;
    lastBuildSummary = "Exported";
    if (lastEditorState) renderOverview(lastEditorState);
    setRailDynamic("build", "exported", true);
  } catch (error) {
    el("build-output").textContent = error.message;
    setRailDynamic("build", "failed", false);
  }
});

function serializeBuild(build) {
  return JSON.stringify(build, null, 2);
}

function applyPresentation(presentation = {}) {
  for (const name of appliedPresentationVariables) {
    document.documentElement.style.removeProperty(name);
  }
  appliedPresentationVariables = new Set();

  const variables = presentation?.css?.variables ?? {};
  for (const [name, value] of Object.entries(variables)) {
    if (name.startsWith("--")) {
      document.documentElement.style.setProperty(name, String(value));
      appliedPresentationVariables.add(name);
    }
  }

  let style = document.getElementById("presentation-css");
  if (!style) {
    style = document.createElement("style");
    style.id = "presentation-css";
    document.head.appendChild(style);
  }
  style.textContent = presentation?.policy?.allowCssText === true ? (presentation?.css?.text ?? "") : "";
}

// Bootstrap: load server state, then offer to restore any saved in-progress work.
// Restore is best-effort and goes through /api/editor/restore so the server
// re-validates before applying; if it fails or there's nothing saved, the
// server's default sample deck stays in place.
refreshEditor()
  .then(offerRestore)
  .catch((error) => setStatus(el("editor-status"), error.message, "err"));
