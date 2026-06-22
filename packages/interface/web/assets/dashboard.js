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
let assetByCard = new Map();
let appliedPresentationVariables = new Set();

async function refreshEditor() {
  const data = await api("/api/editor");
  assetByCard = createAssetMap(data.assets ?? []);
  applyPresentation(data.metadata?.presentation);
  el("meta-title").value = data.metadata?.title ?? "";
  renderCards(data.cards);
  const playerReady = data.playerValidation?.valid;
  setStatus(
    el("editor-status"),
    `${data.cards.length} cards · validation ${data.validation.valid ? "ok" : "failed"} · player-ready ${playerReady ? "yes" : "no"}`,
    data.validation.valid ? "ok" : "err"
  );
}

function renderCards(cards) {
  const list = el("card-list");
  list.innerHTML = "";
  for (const card of cards) {
    const row = document.createElement("div");
    row.className = "card-row";
    const choices = (card.choices ?? []).map((c) => c.id).join(", ");
    const asset = assetByCard.get(card.id);
    row.innerHTML = `
      <div class="card-row__head">
        <div class="card-row__meta">
          ${asset ? `<img class="card-row__art" src="${escapeAttribute(asset.uri)}" alt="" />` : ""}
          <span class="card-row__id">${escapeHtml(card.id)}</span>
        </div>
        <div class="card-row__edit">
          <input type="text" data-edit-text value="${escapeHtml(card.text ?? "")}" />
          <button class="btn" data-save>Save</button>
          <button class="btn" data-delete>✕</button>
        </div>
      </div>
      <div class="card-row__choices">choices: ${escapeHtml(choices)}</div>
    `;
    row.querySelector("[data-save]").addEventListener("click", async () => {
      const text = row.querySelector("[data-edit-text]").value;
      await api(`/api/editor/cards/${encodeURIComponent(card.id)}`, {
        method: "PUT",
        body: { changes: { text } }
      });
      await refreshEditor();
    });
    row.querySelector("[data-delete]").addEventListener("click", async () => {
      await api(`/api/editor/cards/${encodeURIComponent(card.id)}`, { method: "DELETE" });
      await refreshEditor();
    });
    list.appendChild(row);
  }
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
  setStatus(el("editor-status"), "Title saved", "ok");
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
  if (!playSession) return;
  try {
    const result = await api("/api/play/swipe", { method: "POST", body: { sessionId: playSession, direction } });
    renderPlay(result);
    if (result.gameOver) {
      setStatus(el("play-status"), `Game over: ${result.gameOver.faction}`, "err");
    }
  } catch (error) {
    setStatus(el("play-status"), error.message, "err");
  }
}

el("swipe-left").addEventListener("click", () => swipe("left"));
el("swipe-right").addEventListener("click", () => swipe("right"));

function renderPlay(state) {
  renderGauges(state.gauges ?? {});
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
    const list = el("warnings");
    list.innerHTML = "";
    for (const warning of result.warnings) {
      const li = document.createElement("li");
      li.className = `warning warning--${warning.severity}`;
      li.innerHTML = `<span class="warning__code">${escapeHtml(warning.code)}</span> · ${escapeHtml(warning.message)}`;
      list.appendChild(li);
    }
    if (result.warnings.length === 0) {
      list.innerHTML = '<li class="warning">No diagnostics warnings.</li>';
    }
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
  } catch (error) {
    el("build-output").textContent = error.message;
  }
});

el("build-export").addEventListener("click", async () => {
  try {
    const result = await api("/api/build/export", { method: "POST", body: {} });
    el("build-output").textContent = `Exported → ${result.outputPath}\nbuildId: ${result.buildId}`;
  } catch (error) {
    el("build-output").textContent = error.message;
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

refreshEditor().catch((error) => setStatus(el("editor-status"), error.message, "err"));
