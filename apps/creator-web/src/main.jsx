import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const PANELS = [
  { id: "overview", label: "Overview", group: "Project" },
  { id: "content", label: "Content", group: "Authoring" },
  { id: "story", label: "Story", group: "Authoring" },
  { id: "review", label: "Review", group: "Quality" },
  { id: "preview", label: "Preview", group: "Quality" },
  { id: "build", label: "Build", group: "Release" },
  { id: "settings", label: "Settings", group: "Release" }
];

const FACTIONS = ["faith", "people", "military", "treasury"];
const SKINS = [
  ["workbench", "Workbench"],
  ["famicom", "Famicom"],
  ["phantom", "Phantom"],
  ["arcade", "Arcade"],
  ["terminal", "Terminal"]
];

const PERSIST_KEY = "reigns-agent.creator-web.skin";
const DRAFT_KEY = "reigns-agent.creator-web.editor-draft";
const DEFAULT_PANEL = "overview";
const DEFAULT_SKIN = "workbench";

function isKnownPanel(value) {
  return PANELS.some((panel) => panel.id === value);
}

function isKnownSkin(value) {
  return SKINS.some(([id]) => id === value);
}

function readUrlState() {
  if (typeof window === "undefined") {
    return { panel: DEFAULT_PANEL, skin: null };
  }

  const url = new URL(window.location.href);
  const directPanel = url.pathname.startsWith("/workbench/")
    ? url.pathname.slice("/workbench/".length).split("/")[0]
    : null;
  const queryPanel = url.searchParams.get("panel");
  const panel = [directPanel, queryPanel].find(isKnownPanel) ?? DEFAULT_PANEL;
  const skin = url.searchParams.get("skin");

  return {
    panel,
    skin: isKnownSkin(skin) ? skin : null
  };
}

function buildWorkbenchUrl(panel, skin) {
  const url = new URL(window.location.href);
  url.pathname = panel === DEFAULT_PANEL ? "/workbench" : `/workbench/${panel}`;
  if (skin && skin !== DEFAULT_SKIN) {
    url.searchParams.set("skin", skin);
  } else {
    url.searchParams.delete("skin");
  }
  url.searchParams.delete("panel");
  return `${url.pathname}${url.search}${url.hash}`;
}

function syncWorkbenchUrl(panel, skin, mode = "replace") {
  if (typeof window === "undefined") return;
  const nextUrl = buildWorkbenchUrl(panel, skin);
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  window.history[mode === "push" ? "pushState" : "replaceState"](null, "", nextUrl);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok || json?.error) {
    throw new Error(json?.error?.message ?? `Request failed: ${response.status}`);
  }
  return json;
}

function App() {
  const initialUrlState = useMemo(() => readUrlState(), []);
  const [activePanel, setActivePanel] = useState(initialUrlState.panel);
  const [editor, setEditor] = useState(null);
  const [status, setStatus] = useState("Loading project...");
  const [skin, setSkin] = useState(() => initialUrlState.skin ?? (localStorage.getItem(PERSIST_KEY) || DEFAULT_SKIN));
  const [diagnostics, setDiagnostics] = useState(null);
  const [play, setPlay] = useState({ sessionId: null, state: null });
  const [build, setBuild] = useState(null);
  const [busy, setBusy] = useState("");
  const [draftInfo, setDraftInfo] = useState(() => readDraftInfo());
  const [focusCardId, setFocusCardId] = useState(null);

  const assetsByCard = useMemo(() => createAssetMap(editor?.assets ?? []), [editor]);
  const playerReady = editor?.playerValidation?.valid === true;
  const activePanelLabel = PANELS.find((panel) => panel.id === activePanel)?.label ?? "Workspace";

  useEffect(() => {
    document.documentElement.dataset.skin = skin;
    localStorage.setItem(PERSIST_KEY, skin);
    syncWorkbenchUrl(activePanel, skin, "replace");
  }, [activePanel, skin]);

  useEffect(() => {
    function onPopState() {
      const next = readUrlState();
      setActivePanel(next.panel);
      setSkin(next.skin ?? (localStorage.getItem(PERSIST_KEY) || DEFAULT_SKIN));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    void refreshEditor();
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (activePanel !== "preview") return;
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") void swipe("left");
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") void swipe("right");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePanel, play.sessionId, play.state]);

  async function refreshEditor(options = {}) {
    const next = await api("/api/editor");
    setEditor(next);
    if (options.persistDraft) {
      await saveDraftSnapshot();
    }
    setStatus(options.statusMessage ?? `${next.cards.length} cards loaded`);
    return next;
  }

  async function runAction(label, action) {
    setBusy(label);
    try {
      await action();
      return true;
    } catch (error) {
      setStatus(error.message);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function mutateEditor(label, action, successMessage) {
    return runAction(label, async () => {
      await action();
      await refreshEditor({ persistDraft: true, statusMessage: successMessage ?? label });
    });
  }

  async function saveDraftSnapshot() {
    const snapshot = await api("/api/editor/snapshot");
    const entry = {
      savedAt: new Date().toISOString(),
      cardCount: snapshot.bundle?.cards?.length ?? 0,
      bundle: snapshot.bundle
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(entry));
    setDraftInfo({ savedAt: entry.savedAt, cardCount: entry.cardCount });
  }

  async function importBundle(bundle) {
    return mutateEditor(
      "Importing content",
      async () => api("/api/editor/import", { method: "POST", body: { bundle } }),
      "Content imported"
    );
  }

  async function restoreDraft() {
    await runAction("Restoring draft", async () => {
      const draft = readStoredDraft();
      if (!draft) {
        clearStoredDraft();
        setDraftInfo(null);
        setStatus("No local draft found");
        return;
      }
      await api("/api/editor/restore", { method: "POST", body: { bundle: draft.bundle } });
      clearStoredDraft();
      setDraftInfo(null);
      await refreshEditor({ statusMessage: "Local draft restored" });
    });
  }

  function discardDraft() {
    clearStoredDraft();
    setDraftInfo(null);
    setStatus("Local draft discarded");
  }

  async function startPreview() {
    await runAction("Starting preview", async () => {
      const state = await api("/api/play/start", {
        method: "POST",
        body: { locale: navigator.language || "en" }
      });
      setPlay({ sessionId: state.sessionId, state });
      setStatus("Preview session started");
    });
  }

  async function swipe(direction) {
    if (!play.sessionId || play.state?.gameOver || !play.state?.currentCard) return;
    const state = await api("/api/play/swipe", {
      method: "POST",
      body: { sessionId: play.sessionId, direction }
    });
    setPlay((current) => ({ ...current, state }));
  }

  async function runDiagnostics(form) {
    await runAction("Running diagnostics", async () => {
      const result = await api("/api/diagnostics/run", { method: "POST", body: form });
      setDiagnostics(result);
      setStatus(`Diagnostics complete: ${result.healthScore}/100`);
    });
  }

  async function prepareBuild(exportBuild = false) {
    await runAction(exportBuild ? "Exporting build" : "Preparing build", async () => {
      const result = await api(exportBuild ? "/api/build/export" : "/api/build/prepare", {
        method: "POST",
        body: {}
      });
      setBuild(result);
      setStatus(exportBuild ? `Exported ${result.outputPath}` : "Build preview prepared");
    });
  }

  function openPanel(panelId) {
    if (!isKnownPanel(panelId)) return;
    setActivePanel(panelId);
    syncWorkbenchUrl(panelId, skin, "push");
  }

  function focusOnCard(cardId) {
    if (!cardId) return;
    setFocusCardId(cardId);
    openPanel("content");
  }

  function changeSkin(nextSkin) {
    if (!isKnownSkin(nextSkin)) return;
    setSkin(nextSkin);
    syncWorkbenchUrl(activePanel, nextSkin, "replace");
  }

  const playerHref = useMemo(() => {
    const params = new URLSearchParams();
    if (skin !== DEFAULT_SKIN) params.set("skin", skin);
    return params.size > 0 ? `/play?${params.toString()}` : "/play";
  }, [skin]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">RA</span>
          <div>
            <h1>ReignsAgent Creator</h1>
            <p>{editor?.metadata?.title ?? "Project workspace"}</p>
          </div>
        </div>
        <div className="topbar__readout" aria-label="Current workspace state">
          <span>{activePanelLabel}</span>
          <span>{editor?.cards?.length ?? 0} cards</span>
          <span>{playerReady ? "player ready" : "player blocked"}</span>
        </div>
        <div className="topbar__tools">
          <label className="skin-select">
            Skin
            <select value={skin} onChange={(event) => changeSkin(event.target.value)}>
              {SKINS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <a className="link-button" href={playerHref}>Player</a>
        </div>
      </header>

      <div className="workspace">
        <nav className="rail" aria-label="Creator panels">
          {PANELS.map(({ id, label, group }, index) => (
            <button
              key={id}
              className={activePanel === id ? "rail__item rail__item--active" : "rail__item"}
              type="button"
              onClick={() => openPanel(id)}
            >
              <span className="phantom-shape-wrapper" aria-hidden="true">
                <span className="phantom-shape phantom-shape--red phantom-jelly" />
                <span className="phantom-shape phantom-shape--cyan phantom-jelly" />
              </span>
              <span className="rail__meta">{String(index + 1).padStart(2, "0")} / {group}</span>
              <span className="rail__label">{label}</span>
              <small>{panelStatus(id, { editor, playerReady, diagnostics, build })}</small>
            </button>
          ))}
        </nav>

        <main className="stage">
          <div className="stage__status" role="status">
            <span>Local session</span>
            <strong>{busy || status}</strong>
          </div>
          {draftInfo && (
            <DraftBanner
              draftInfo={draftInfo}
              onRestore={restoreDraft}
              onDiscard={discardDraft}
            />
          )}
          {activePanel === "overview" && (
            <Overview
              editor={editor}
              playerReady={playerReady}
              diagnostics={diagnostics}
              build={build}
              onOpen={openPanel}
            />
          )}
          {activePanel === "content" && (
            <ContentPanel
              editor={editor}
              assetsByCard={assetsByCard}
              onImport={importBundle}
              onMutate={mutateEditor}
              onStatus={setStatus}
              focusCardId={focusCardId}
            />
          )}
          {activePanel === "story" && (
            <StoryPanel
              editor={editor}
              diagnostics={diagnostics}
              onOpen={openPanel}
              onFocusCard={focusOnCard}
            />
          )}
          {activePanel === "review" && <ReviewPanel diagnostics={diagnostics} onRun={runDiagnostics} onOpen={openPanel} />}
          {activePanel === "preview" && (
            <PreviewPanel
              play={play}
              assetsByCard={assetsByCard}
              playerReady={playerReady}
              onStart={startPreview}
              onSwipe={swipe}
            />
          )}
          {activePanel === "build" && <BuildPanel build={build} onPrepare={prepareBuild} />}
          {activePanel === "settings" && <SettingsPanel editor={editor} onRefresh={refreshEditor} onStatus={setStatus} />}
        </main>
      </div>
    </div>
  );
}

function Overview({ editor, playerReady, diagnostics, build, onOpen }) {
  return (
    <section className="panel">
      <PanelHead title="Project Overview" note="Workspace health, content readiness, and next actions." />
      <div className="metric-grid">
        <Metric label="Project" value={editor?.metadata?.title ?? "Untitled"} />
        <Metric label="Cards" value={String(editor?.cards?.length ?? 0)} />
        <Metric label="Validation" value={editor?.validation?.valid ? "Valid" : "Needs work"} tone={editor?.validation?.valid ? "good" : "bad"} />
        <Metric label="Player-ready" value={playerReady ? "Ready" : "Blocked"} tone={playerReady ? "good" : "bad"} />
        <Metric label="Review" value={diagnostics ? `${diagnostics.healthScore}/100` : "Not run"} />
        <Metric label="Build" value={build ? "Prepared" : "Not prepared"} />
      </div>
      <div className="action-row">
        <button className="btn btn--primary" onClick={() => onOpen("content")}>Edit cards</button>
        <button className="btn" onClick={() => onOpen("review")}>Run review</button>
        <button className="btn" onClick={() => onOpen("preview")}>Preview</button>
        <button className="btn" onClick={() => onOpen("build")}>Build</button>
      </div>
    </section>
  );
}

function DraftBanner({ draftInfo, onRestore, onDiscard }) {
  return (
    <div className="draft-banner" role="status">
      <div>
        <strong>Local draft available</strong>
        <span>{draftInfo.cardCount ?? 0} cards · {formatDraftTime(draftInfo.savedAt)}</span>
      </div>
      <div className="draft-banner__actions">
        <button className="btn btn--primary" type="button" onClick={() => void onRestore()}>Restore</button>
        <button className="btn btn--ghost" type="button" onClick={onDiscard}>Discard</button>
      </div>
    </div>
  );
}

function ContentPanel({ editor, assetsByCard, onImport, onMutate, onStatus, focusCardId }) {
  const [paste, setPaste] = useState("");
  const [query, setQuery] = useState("");
  const [validationFilter, setValidationFilter] = useState("all");
  const [selectedCardId, setSelectedCardId] = useState(null);

  const cardItems = useMemo(() => (editor?.cards ?? []).map((card, index) => ({
    card,
    validation: cardValidationState(editor, card, index)
  })), [editor]);

  const visibleItems = useMemo(() => {
    return cardItems.filter(({ card, validation }) => {
      if (!matchesCardQuery(card, query)) return false;
      if (validationFilter === "invalid") return validation.invalid;
      if (validationFilter === "player-ready") return !validation.invalid;
      return true;
    });
  }, [cardItems, query, validationFilter]);

  useEffect(() => {
    if (focusCardId && cardItems.some(({ card }) => card.id === focusCardId)) {
      setSelectedCardId(focusCardId);
      // Clear the filters so the focused card is guaranteed visible.
      setQuery("");
      setValidationFilter("all");
      return;
    }
    if (visibleItems.length === 0) {
      setSelectedCardId(null);
      return;
    }
    if (!selectedCardId || !visibleItems.some(({ card }) => card.id === selectedCardId)) {
      setSelectedCardId(visibleItems[0].card.id);
    }
  }, [focusCardId, cardItems, visibleItems, selectedCardId]);

  const activeIndex = visibleItems.findIndex(({ card }) => card.id === selectedCardId);
  const activeItem = activeIndex >= 0 ? visibleItems[activeIndex] : null;

  async function loadSample() {
    try {
      const sample = await api("/api/samples/oss-court");
      await onImport(sample);
    } catch (error) {
      onStatus(error.message);
    }
  }

  async function importPasted() {
    try {
      const imported = await onImport(JSON.parse(paste));
      if (imported) setPaste("");
    } catch (error) {
      onStatus(error.message);
    }
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      await onImport(JSON.parse(text));
    } catch (error) {
      onStatus(error.message);
    }
  }

  function selectRelative(step) {
    if (activeIndex < 0) return;
    const next = visibleItems[activeIndex + step];
    if (next) setSelectedCardId(next.card.id);
  }

  return (
    <section className="panel panel--content">
      <PanelHead title="Content / Cards" note="Card text, left/right choices, faction effects, tags, variables, and art bindings." />
      <div className="tool-strip">
        <label className="file-button">
          <input type="file" accept=".json,application/json" onChange={(event) => void importFile(event.target.files?.[0])} />
          Import JSON
        </label>
        <button className="btn" onClick={() => void loadSample()}>Load sample deck</button>
        <span className="muted">{editor?.cards?.length ?? 0} cards</span>
      </div>
      <div className="editor-controls" aria-label="Card filters">
        <label>
          Search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="id, text, choice"
          />
        </label>
        <label>
          State
          <select value={validationFilter} onChange={(event) => setValidationFilter(event.target.value)}>
            <option value="all">All cards</option>
            <option value="player-ready">Player-ready</option>
            <option value="invalid">Invalid</option>
          </select>
        </label>
        <span className="muted">{visibleItems.length} shown</span>
      </div>
      <textarea
        className="json-paste"
        value={paste}
        onChange={(event) => setPaste(event.target.value)}
        placeholder="Paste content bundle JSON"
        rows={4}
      />
      <button className="btn btn--primary" disabled={!paste.trim()} onClick={() => void importPasted()}>Import pasted JSON</button>
      <div className="content-workspace">
        <aside className="card-switcher">
          <div className="card-switcher__head">
            <strong>{visibleItems.length} cards</strong>
            <span>{selectedCardId ? `${activeIndex + 1} / ${visibleItems.length}` : "0 / 0"}</span>
          </div>
          <div className="card-switcher__list" role="tablist" aria-label="Cards">
            {visibleItems.map(({ card, validation }) => (
              <button
                key={card.id}
                className={card.id === selectedCardId ? "card-switcher__item card-switcher__item--active" : "card-switcher__item"}
                type="button"
                role="tab"
                aria-selected={card.id === selectedCardId}
                onClick={() => setSelectedCardId(card.id)}
              >
                <div className="card-switcher__meta">
                  <strong>{card.id}</strong>
                  <span className={validation.invalid ? "card-badge card-badge--invalid" : "card-badge card-badge--ready"}>
                    {validation.invalid ? "invalid" : "ready"}
                  </span>
                </div>
                <p>{cardExcerpt(card)}</p>
                <small>{validation.messages.length > 0 ? `${validation.messages.length} messages` : "No validation messages"}</small>
              </button>
            ))}
            {visibleItems.length === 0 && <div className="empty-inline">No cards match the current filters.</div>}
          </div>
          <AddCard onMutate={onMutate} onCreated={setSelectedCardId} />
        </aside>

        <div className="content-detail">
          {activeItem ? (
            <>
              <div className="content-detail__toolbar">
                <div>
                  <strong>{activeItem.card.id}</strong>
                  <span>{activeIndex + 1} of {visibleItems.length}</span>
                </div>
                <div className="content-detail__nav">
                  <button className="btn btn--ghost" type="button" disabled={activeIndex <= 0} onClick={() => selectRelative(-1)}>Previous</button>
                  <button className="btn btn--ghost" type="button" disabled={activeIndex === -1 || activeIndex >= visibleItems.length - 1} onClick={() => selectRelative(1)}>Next</button>
                </div>
              </div>
              <CardEditor
                key={activeItem.card.id}
                card={activeItem.card}
                asset={assetsByCard.get(activeItem.card.id)}
                validation={activeItem.validation}
                onMutate={onMutate}
                onStatus={onStatus}
              />
            </>
          ) : (
            <div className="empty-state">
              <p>No cards match the current filters.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CardEditor({ card, asset, validation, onMutate, onStatus }) {
  const [text, setText] = useState(card.text ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setText(card.text ?? "");
    setConfirmDelete(false);
  }, [card.id, card.text]);

  async function saveText() {
    if (text === (card.text ?? "")) return;
    await onMutate(
      `Saving ${card.id}`,
      async () => api(`/api/editor/cards/${encodeURIComponent(card.id)}`, {
        method: "PUT",
        body: { changes: { text } }
      }),
      `Saved ${card.id}`
    );
  }

  async function removeCard() {
    await onMutate(
      `Deleting ${card.id}`,
      async () => api(`/api/editor/cards/${encodeURIComponent(card.id)}`, { method: "DELETE" }),
      `Deleted ${card.id}`
    );
  }

  const invalid = validation.invalid;
  const messages = validation.messages;

  return (
    <article className="card-editor">
      <div className="card-editor__head">
        {asset ? <img src={`/${asset.uri}`} alt="" /> : <span className="art-placeholder" />}
        <div>
          <strong>{card.id}</strong>
          <p>{(card.choices ?? []).map((choice) => choice.id).join(" / ")}</p>
        </div>
        <div className="card-editor__actions">
          <span className={invalid ? "card-badge card-badge--invalid" : "card-badge card-badge--ready"}>
            {invalid ? "invalid" : "player-ready"}
          </span>
          <button className="icon-button" title="Delete card" type="button" onClick={() => setConfirmDelete(true)}>x</button>
        </div>
      </div>
      <div className="card-editor__meta">
        <label className="readonly-field">
          Card id
          <input value={card.id} readOnly />
        </label>
        <label className="readonly-field">
          Asset
          <input value={asset?.uri ?? "none"} readOnly />
        </label>
      </div>
      {messages.length > 0 && (
        <ul className="validation-list">
          {messages.map((message, index) => (
            <li key={`${message.level}-${index}`} className={`validation-list__item validation-list__item--${message.level}`}>
              {message.text}
            </li>
          ))}
        </ul>
      )}
      {confirmDelete && (
        <div className="confirm-row">
          <span>Delete this card?</span>
          <button className="btn btn--danger" type="button" onClick={() => void removeCard()}>Delete</button>
          <button className="btn btn--ghost" type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
        </div>
      )}
      <div className="field-row">
        <input value={text} onChange={(event) => setText(event.target.value)} aria-label={`${card.id} text`} />
        <button className="btn" disabled={text === (card.text ?? "")} onClick={() => void saveText()}>Save text</button>
      </div>
      <div className="choice-grid">
        {(card.choices ?? []).map((choice) => (
          <ChoiceEditor
            key={choice.id}
            cardId={card.id}
            choice={choice}
            onMutate={onMutate}
            onStatus={onStatus}
          />
        ))}
      </div>
    </article>
  );
}

function ChoiceEditor({ cardId, choice, onMutate, onStatus }) {
  const [label, setLabel] = useState(choice.label ?? "");
  const [advanced, setAdvanced] = useState(JSON.stringify(choice.effects ?? {}, null, 2));
  const [factions, setFactions] = useState(() => createFactionDraft(choice.effects?.factions));

  useEffect(() => {
    setLabel(choice.label ?? "");
    setAdvanced(JSON.stringify(choice.effects ?? {}, null, 2));
    setFactions(createFactionDraft(choice.effects?.factions));
  }, [choice.id, choice.label, choice.effects]);

  async function saveLabel() {
    if (label === (choice.label ?? "")) return;
    await onMutate(
      `Saving ${choice.id} label`,
      async () => api(choicePath(cardId, choice.id), { method: "PATCH", body: { label } }),
      `Saved ${choice.id} label`
    );
  }

  async function saveFaction(faction) {
    const value = factions[faction] ?? "";
    const raw = value.trim();
    const current = choice.effects?.factions?.[faction];
    if (raw === "" && current === undefined) return;
    if (raw !== "" && Number(raw) === current) return;
    if (raw !== "" && !Number.isFinite(Number(raw))) {
      onStatus(`${faction} must be finite`);
      setFactions(createFactionDraft(choice.effects?.factions));
      return;
    }
    const path = `${choicePath(cardId, choice.id)}/effects/faction/${faction}`;
    await onMutate(
      `Updating ${choice.id} ${faction}`,
      async () => {
        if (raw === "") {
          await api(path, { method: "DELETE" });
        } else {
          await api(path, { method: "POST", body: { value: Number(raw) } });
        }
      },
      `Updated ${choice.id} ${faction}`
    );
  }

  async function saveEffects() {
    let effects;
    try {
      effects = JSON.parse(advanced);
    } catch (error) {
      onStatus(error.message);
      return;
    }
    await onMutate(
      `Saving ${choice.id} effects`,
      async () => api(choicePath(cardId, choice.id), { method: "PATCH", body: { effects } }),
      `Saved ${choice.id} effects`
    );
  }

  return (
    <div className="choice-editor">
      <div className="choice-editor__head">
        <strong>{choice.id}</strong>
        <input value={label} onChange={(event) => setLabel(event.target.value)} onBlur={() => void saveLabel()} placeholder="choice label" />
      </div>
      <div className="faction-grid">
        {FACTIONS.map((faction) => (
          <label key={faction}>
            {faction}
            <input
              type="number"
              value={factions[faction] ?? ""}
              onChange={(event) => setFactions((current) => ({ ...current, [faction]: event.target.value }))}
              onBlur={() => void saveFaction(faction)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
        ))}
      </div>
      <EffectRows
        title="Tags"
        kind="tag"
        entries={choice.effects?.tags ?? {}}
        cardId={cardId}
        choiceId={choice.id}
        onMutate={onMutate}
        onStatus={onStatus}
      />
      <EffectRows
        title="Variables"
        kind="variable"
        entries={choice.effects?.variables ?? {}}
        cardId={cardId}
        choiceId={choice.id}
        onMutate={onMutate}
        onStatus={onStatus}
      />
      <details>
        <summary>Advanced effects JSON</summary>
        <textarea value={advanced} onChange={(event) => setAdvanced(event.target.value)} rows={5} />
        <button className="btn" type="button" onClick={() => void saveEffects()}>Save effects JSON</button>
      </details>
    </div>
  );
}

function EffectRows({ title, kind, entries, cardId, choiceId, onMutate, onStatus }) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState(kind === "tag" ? "true" : "");
  const sortedEntries = useMemo(() => Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)), [entries]);

  async function applyEntry(key, rawValue) {
    const cleanedKey = key.trim();
    if (!cleanedKey) {
      onStatus(`${title} key required`);
      return false;
    }
    const value = kind === "tag" ? parseTagValue(rawValue) : parseScalar(rawValue);
    const path = effectPath(cardId, choiceId, kind, cleanedKey);
    const updated = await onMutate(
      `Updating ${choiceId} ${cleanedKey}`,
      async () => {
        if (value === null) {
          await api(path, { method: "DELETE" });
        } else {
          await api(path, { method: "POST", body: { value } });
        }
      },
      `Updated ${choiceId} ${cleanedKey}`
    );
    return updated;
  }

  async function removeEntry(key) {
    await onMutate(
      `Removing ${choiceId} ${key}`,
      async () => api(effectPath(cardId, choiceId, kind, key), { method: "DELETE" }),
      `Removed ${choiceId} ${key}`
    );
  }

  async function addEntry() {
    const updated = await applyEntry(newKey, newValue);
    if (updated) {
      setNewKey("");
      setNewValue(kind === "tag" ? "true" : "");
    }
  }

  return (
    <div className="effect-panel">
      <div className="effect-panel__head">
        <span>{title}</span>
        <small>{sortedEntries.length}</small>
      </div>
      <div className="effect-rows">
        {sortedEntries.map(([key, value]) => (
          <EffectEntryRow
            key={key}
            entryKey={key}
            value={value}
            onApply={(nextValue) => applyEntry(key, nextValue)}
            onRemove={() => removeEntry(key)}
          />
        ))}
        {sortedEntries.length === 0 && <span className="empty-inline">No entries</span>}
      </div>
      <div className="effect-row effect-row--new">
        <input value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder={`${kind} key`} />
        <input
          value={newValue}
          onChange={(event) => setNewValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addEntry();
          }}
          placeholder="value"
        />
        <button className="btn btn--ghost" type="button" disabled={!newKey.trim()} onClick={() => void addEntry()}>Add</button>
      </div>
    </div>
  );
}

function EffectEntryRow({ entryKey, value, onApply, onRemove }) {
  const [draft, setDraft] = useState(formatEffectValue(value));

  useEffect(() => {
    setDraft(formatEffectValue(value));
  }, [entryKey, value]);

  const original = formatEffectValue(value);

  return (
    <div className="effect-row">
      <input className="effect-row__key" value={entryKey} readOnly />
      <input
        className="effect-row__value"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft !== original) void onApply(draft);
        }}
      />
      <button className="btn btn--ghost" type="button" disabled={draft === original} onClick={() => void onApply(draft)}>Apply</button>
      <button className="btn btn--ghost" type="button" onClick={() => void onRemove()}>Remove</button>
    </div>
  );
}

function AddCard({ onMutate, onCreated }) {
  const [id, setId] = useState("");
  const [text, setText] = useState("");

  async function createCard() {
    const nextId = id;
    const created = await onMutate(
      "Creating card",
      async () => api("/api/editor/cards", {
        method: "POST",
        body: {
          card: {
            id,
            text,
            choices: [
              { id: "left", label: "Left", effects: { factions: {} } },
              { id: "right", label: "Right", effects: { factions: {} } }
            ]
          }
        }
      }),
      "Card created"
    );
    if (created) {
      setId("");
      setText("");
      onCreated?.(nextId);
    }
  }

  return (
    <details className="add-card">
      <summary>Add card</summary>
      <div className="field-row">
        <input value={id} onChange={(event) => setId(event.target.value)} placeholder="card id" />
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="card text" />
        <button className="btn btn--primary" disabled={!id || !text} onClick={() => void createCard()}>Create</button>
      </div>
    </details>
  );
}

function StoryPanel({ editor, diagnostics, onOpen, onFocusCard }) {
  const [graph, setGraph] = useState(null);
  const [graphError, setGraphError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setGraphError("");
      try {
        const result = await api("/api/editor/graph");
        if (!cancelled) setGraph(result);
      } catch (error) {
        if (!cancelled) {
          setGraph(null);
          setGraphError(error.message);
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [editor, refreshKey]);

  return (
    <section className="panel panel--story">
      <PanelHead title="Story / Graph" note="Card-to-card transitions driven by tags and variables. Click a node to edit it." />
      <div className="metric-grid">
        <Metric label="Narrative nodes" value={`${editor?.cards?.length ?? 0} cards`} />
        <Metric
          label="Reachable"
          value={graph ? `${graph.reachableCards.length}/${graph.nodes.length}` : "loading"}
          tone={graph && graph.unreachableCards.length === 0 ? "good" : ""}
        />
        <Metric
          label="Unreachable"
          value={graph ? String(graph.unreachableCards.length) : "-"}
          tone={graph && graph.unreachableCards.length > 0 ? "bad" : ""}
        />
        <Metric
          label="Isolated"
          value={graph ? String(graph.isolatedCards.length) : "-"}
          tone={graph && graph.isolatedCards.length > 0 ? "bad" : ""}
        />
      </div>
      <div className="graph-controls">
        <button className="btn" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Refresh graph</button>
        {diagnostics ? (
          <button className="btn btn--ghost" type="button" onClick={() => onOpen("review")}>
            Review diagnostics · {diagnostics.healthScore}/100
          </button>
        ) : (
          <span className="muted">Run review for simulation coverage</span>
        )}
        <GraphLegend />
      </div>
      {graphError ? (
        <div className="empty-state">
          <p>Could not load story graph: {graphError}</p>
        </div>
      ) : graph ? (
        graph.nodes.length === 0 ? (
          <div className="empty-state">
            <p>No cards to graph. Add or import cards first.</p>
          </div>
        ) : (
          <StoryGraph graph={graph} cards={editor?.cards ?? []} onFocusCard={onFocusCard} />
        )
      ) : (
        <div className="empty-state">
          <p>Building story graph...</p>
        </div>
      )}
    </section>
  );
}

function GraphLegend() {
  const items = [
    ["entry", "Entry"],
    ["reachable", "Reachable"],
    ["unreachable", "Unreachable"],
    ["isolated", "Isolated"]
  ];
  return (
    <ul className="graph-legend">
      {items.map(([tone, label]) => (
        <li key={tone} className={`graph-legend__item graph-legend__item--${tone}`}>
          <span className="graph-legend__dot" />{label}
        </li>
      ))}
    </ul>
  );
}

/**
 * StoryGraph renders the card-transition graph on an HTML5 canvas. Nodes are
 * laid out with a lightweight force-directed algorithm (no dependencies) and
 * re-skinned automatically by reading the active CSS variables. Pan by dragging
 * the background; click a node to open it in the Content panel.
 */
function StoryGraph({ graph, cards, onFocusCard }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const layoutRef = useRef({ nodes: [], byId: new Map(), pan: { x: 0, y: 0 }, hover: null });
  const animationRef = useRef(0);
  const [tooltip, setTooltip] = useState(null);

  // Map card id -> card object for quick metadata lookups (text, excerpt).
  const cardById = useMemo(() => {
    const map = new Map();
    for (const card of cards) map.set(card.id, card);
    return map;
  }, [cards]);

  const nodeTone = useMemo(() => {
    const map = new Map();
    if (!graph) return map;
    const isolated = new Set(graph.isolatedCards);
    const unreachable = new Set(graph.unreachableCards);
    const entry = new Set(graph.initiallyEligibleCards);
    for (const node of graph.nodes) {
      if (isolated.has(node.id)) map.set(node.id, "isolated");
      else if (unreachable.has(node.id)) map.set(node.id, "unreachable");
      else if (entry.has(node.id)) map.set(node.id, "entry");
      else map.set(node.id, "reachable");
    }
    return map;
  }, [graph]);

  const colors = useSkinColors();

  // Initialize / reset node positions when the graph identity changes.
  useEffect(() => {
    if (!graph) return;
    const nodes = graph.nodes.map((node, index) => {
      const angle = (index / Math.max(graph.nodes.length, 1)) * Math.PI * 2;
      const radius = 160 + (graph.nodes.length > 8 ? (graph.nodes.length - 8) * 12 : 0);
      return {
        id: node.id,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0
      };
    });
    layoutRef.current.nodes = nodes;
    layoutRef.current.byId = new Map(nodes.map((node) => [node.id, node]));
    layoutRef.current.pan = { x: 0, y: 0 };
  }, [graph]);

  // Force simulation + render loop.
  useEffect(() => {
    if (!graph) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let running = true;
    let temperature = 1;

    function resize() {
      const container = canvas.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function step() {
      if (!running) return;
      const { nodes } = layoutRef.current;
      const edgeList = graph.edges;
      const edgeSet = new Set(edgeList.map((edge) => `${edge.from}->${edge.to}`));

      // Repulsion between all node pairs.
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) dist = 1;
          const force = 9000 / (dist * dist);
          const fx = (dx / dist) * force * temperature;
          const fy = (dy / dist) * force * temperature;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      // Attraction along edges.
      for (const edge of edgeList) {
        const from = layoutRef.current.byId.get(edge.from);
        const to = layoutRef.current.byId.get(edge.to);
        if (!from || !to) continue;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 180) * 0.02 * temperature;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        from.vx += fx;
        from.vy += fy;
        to.vx -= fx;
        to.vy -= fy;
      }

      // Integrate with damping.
      for (const node of nodes) {
        node.vx *= 0.82;
        node.vy *= 0.82;
        node.x += node.vx;
        node.y += node.vy;
      }

      temperature = Math.max(temperature * 0.97, 0.02);
      render();
      if (temperature > 0.03 || hasMoving(nodes)) {
        animationRef.current = requestAnimationFrame(step);
      } else {
        animationRef.current = requestAnimationFrame(step);
      }
    }

    function hasMoving(nodes) {
      for (const node of nodes) {
        if (Math.abs(node.vx) > 0.4 || Math.abs(node.vy) > 0.4) return true;
      }
      return false;
    }

    function render() {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2 + layoutRef.current.pan.x;
      const cy = height / 2 + layoutRef.current.pan.y;

      // Edges first so nodes render on top.
      for (const edge of graph.edges) {
        const from = layoutRef.current.byId.get(edge.from);
        const to = layoutRef.current.byId.get(edge.to);
        if (!from || !to) continue;
        const x1 = cx + from.x;
        const y1 = cy + from.y;
        const x2 = cx + to.x;
        const y2 = cy + to.y;
        const fromTone = nodeTone.get(edge.from);
        const toTone = nodeTone.get(edge.to);
        const edgeTone = toTone === "unreachable" ? colors.danger : colors.muted;
        ctx.strokeStyle = edgeTone;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Arrowhead.
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLen = 9;
        const nodeRadius = NODE_RADIUS;
        const tipX = x2 - Math.cos(angle) * (nodeRadius + 2);
        const tipY = y2 - Math.sin(angle) * (nodeRadius + 2);
        ctx.fillStyle = edgeTone;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
          tipX - Math.cos(angle - 0.4) * headLen,
          tipY - Math.sin(angle - 0.4) * headLen
        );
        ctx.lineTo(
          tipX - Math.cos(angle + 0.4) * headLen,
          tipY - Math.sin(angle + 0.4) * headLen
        );
        ctx.closePath();
        ctx.fill();

        // Choice badges (L/R) at edge midpoint.
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const choiceIds = (edge.choices ?? []).map((choice) => choice.id);
        if (choiceIds.length > 0) {
          drawChoiceBadge(ctx, midX, midY, choiceIds, colors);
        }
      }

      // Nodes.
      for (const node of layoutRef.current.nodes) {
        const x = cx + node.x;
        const y = cy + node.y;
        const tone = nodeTone.get(node.id) ?? "reachable";
        const fill = toneFill(tone, colors);
        const stroke = toneStroke(tone, colors);
        const isHover = layoutRef.current.hover === node.id;

        ctx.beginPath();
        ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = tone === "unreachable" || tone === "isolated" ? 2 : isHover ? 2.5 : 1.5;
        if (tone === "unreachable" || tone === "isolated") ctx.setLineDash([4, 3]);
        ctx.strokeStyle = isHover ? colors.accent : stroke;
        ctx.stroke();
        ctx.setLineDash([]);

        // Label: card id, truncated.
        ctx.fillStyle = colors.ink;
        ctx.font = "600 11px var(--font-data, monospace)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const label = node.id.length > 14 ? `${node.id.slice(0, 13)}…` : node.id;
        ctx.fillText(label, x, y + NODE_RADIUS + 4);
      }
    }

    resize();
    step();
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => {
      running = false;
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", onResize);
    };
  }, [graph, nodeTone, colors]);

  // Pointer interaction: hover + click + pan.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph) return;
    let dragging = false;
    let dragStart = null;

    function pointer(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function nodeAt(point) {
      const cx = canvas.getBoundingClientRect().width / 2 + layoutRef.current.pan.x;
      const cy = canvas.getBoundingClientRect().height / 2 + layoutRef.current.pan.y;
      for (const node of layoutRef.current.nodes) {
        const nx = cx + node.x;
        const ny = cy + node.y;
        const dx = point.x - nx;
        const dy = point.y - ny;
        if (dx * dx + dy * dy <= (NODE_RADIUS + 4) * (NODE_RADIUS + 4)) return node.id;
      }
      return null;
    }

    function onMove(event) {
      const point = pointer(event);
      if (dragging) {
        layoutRef.current.pan.x += point.x - dragStart.x;
        layoutRef.current.pan.y += point.y - dragStart.y;
        dragStart = point;
        return;
      }
      const id = nodeAt(point);
      if (id !== layoutRef.current.hover) {
        layoutRef.current.hover = id;
        canvas.style.cursor = id ? "pointer" : "grab";
        if (id) {
          const card = cardById.get(id);
          const incoming = graph.edges.filter((edge) => edge.to === id);
          const outgoing = graph.edges.filter((edge) => edge.from === id);
          setTooltip({
            id,
            text: card?.text ?? "",
            tone: nodeTone.get(id),
            incoming: incoming.length,
            outgoing: outgoing.length,
            x: point.x,
            y: point.y
          });
        } else {
          setTooltip(null);
        }
      } else if (id) {
        setTooltip((current) => (current ? { ...current, x: point.x, y: point.y } : current));
      }
    }

    function onDown(event) {
      const point = pointer(event);
      const id = nodeAt(point);
      if (!id) {
        dragging = true;
        dragStart = point;
        canvas.style.cursor = "grabbing";
      }
    }

    function onUp(event) {
      if (dragging) {
        dragging = false;
        canvas.style.cursor = "grab";
        dragStart = null;
        return;
      }
      const point = pointer(event);
      const id = nodeAt(point);
      if (id) {
        setTooltip(null);
        onFocusCard?.(id);
      }
    }

    function onLeave() {
      dragging = false;
      dragStart = null;
      layoutRef.current.hover = null;
      canvas.style.cursor = "default";
      setTooltip(null);
    }

    canvas.style.cursor = "grab";
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onLeave);
    return () => {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [graph, cardById, nodeTone, onFocusCard]);

  return (
    <div className="graph-container" ref={containerRef}>
      <canvas ref={canvasRef} className="graph-canvas" />
      {tooltip && (
        <div className="graph-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <strong>{tooltip.id}</strong>
          {tooltip.text && <p>{tooltip.text}</p>}
          <small className={`graph-tooltip__tone graph-tooltip__tone--${tooltip.tone}`}>{tooltip.tone}</small>
          <small>{tooltip.incoming} in · {tooltip.outgoing} out</small>
        </div>
      )}
    </div>
  );
}

const NODE_RADIUS = 20;

/**
 * useSkinColors reads the active dashboard CSS variables once per render so the
 * canvas graph repaints with the correct palette for whichever skin (workbench,
 * famicom, phantom, arcade, terminal) is active. The skin value is read from
 * document.documentElement.dataset.skin, matching how App sets it.
 */
function useSkinColors() {
  const [colors, setColors] = useState(() => readSkinColors());
  useEffect(() => {
    setColors(readSkinColors());
    const observer = new MutationObserver(() => setColors(readSkinColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin"] });
    return () => observer.disconnect();
  }, []);
  return colors;
}

function readSkinColors() {
  const root = getComputedStyle(document.documentElement);
  const read = (name) => root.getPropertyValue(name).trim();
  return {
    bg: read("--bg") || "#10110f",
    ink: read("--ink") || "#f1eee4",
    muted: read("--muted") || "#a5a091",
    accent: read("--accent") || "#d8a83a",
    accent2: read("--accent-2") || "#53b6a5",
    ok: read("--ok") || "#7ccf8a",
    danger: read("--danger") || "#e06b5f",
    surface: read("--surface") || "#171915"
  };
}

function toneFill(tone, colors) {
  switch (tone) {
    case "entry": return colors.accent;
    case "reachable": return colors.surface;
    case "unreachable": return colors.surface;
    case "isolated": return colors.surface;
    default: return colors.surface;
  }
}

function toneStroke(tone, colors) {
  switch (tone) {
    case "entry": return colors.accent;
    case "reachable": return colors.ok;
    case "unreachable": return colors.danger;
    case "isolated": return colors.muted;
    default: return colors.muted;
  }
}

function drawChoiceBadge(ctx, x, y, choiceIds, colors) {
  const labels = choiceIds.map((choiceId) => {
    if (choiceId === "left") return "L";
    if (choiceId === "right") return "R";
    return choiceId.slice(0, 1).toUpperCase();
  });
  const text = labels.join("/");
  ctx.font = "700 9px monospace";
  const metrics = ctx.measureText(text);
  const padding = 4;
  const w = metrics.width + padding * 2;
  const h = 14;
  ctx.fillStyle = colors.bg;
  ctx.strokeStyle = colors.accent2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(x - w / 2, y - h / 2, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.accent2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function ReviewPanel({ diagnostics, onRun, onOpen }) {
  const [cycles, setCycles] = useState(500);
  const [maxTurns, setMaxTurns] = useState(40);
  const [seed, setSeed] = useState(1);

  return (
    <section className="panel">
      <PanelHead title="Review Diagnostics" note="Creator-facing Monte Carlo review with reproducible seed inputs." />
      <div className="field-row field-row--compact">
        <label>Cycles <input type="number" min="1" value={cycles} onChange={(event) => setCycles(Number(event.target.value))} /></label>
        <label>Max turns <input type="number" min="1" value={maxTurns} onChange={(event) => setMaxTurns(Number(event.target.value))} /></label>
        <label>Seed <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label>
        <button className="btn btn--primary" onClick={() => void onRun({ cycles, maxTurns, seed })}>Run review</button>
      </div>
      {diagnostics ? (
        <>
          <div className="health">
            <strong>{diagnostics.healthScore}/100</strong>
            <span>{diagnostics.headline}</span>
          </div>
          <ul className="warning-list">
            {(diagnostics.warnings ?? []).map((warning, index) => (
              <li key={`${warning.code}-${index}`} className={`warning warning--${warning.severity}`}>
                <button className="btn btn--ghost btn--compact warning__code" type="button" onClick={() => onOpen("content")}>
                  {warning.code}
                </button>
                <span>{warning.message}</span>
              </li>
            ))}
            {diagnostics.warnings?.length === 0 && <li className="warning">No diagnostics warnings.</li>}
          </ul>
        </>
      ) : (
        <div className="empty-state">
          <p>No review has been run in this session.</p>
        </div>
      )}
    </section>
  );
}

function PreviewPanel({ play, assetsByCard, playerReady, onStart, onSwipe }) {
  const state = play.state;
  const card = state?.currentCard;
  const asset = card ? assetsByCard.get(card.id) : null;
  const left = card?.choices?.find((choice) => choice.id === "left");
  const right = card?.choices?.find((choice) => choice.id === "right");

  return (
    <section className="panel">
      <PanelHead title="Developer Preview" note="Debuggable preview over the same headless runtime used by player builds." />
      <div className="preview-layout">
        <div className="gauge-stack">
          {Object.entries(state?.gauges ?? {}).map(([name, gauge]) => (
            <div className="gauge" key={name}>
              <span>{name} · {gauge.value}</span>
              <div><b style={{ width: `${gauge.left}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="play-card">
          {asset && <img src={`/${asset.uri}`} alt="" />}
          <p>{card?.text ?? (state?.gameOver ? "The reign has ended." : "No preview session.")}</p>
          <div className="choice-buttons">
            <button className="btn btn--choice" disabled={!card} onClick={() => void onSwipe("left")}>← {left?.label ?? "Left"}</button>
            <button className="btn btn--choice" disabled={!card} onClick={() => void onSwipe("right")}>{right?.label ?? "Right"} →</button>
          </div>
        </div>
      </div>
      <div className="action-row">
        <button className="btn btn--primary" disabled={!playerReady} onClick={() => void onStart()}>Start preview</button>
        <span className="muted">Keyboard: Arrow keys or A/D. Session: {play.sessionId ?? "none"}</span>
      </div>
    </section>
  );
}

function BuildPanel({ build, onPrepare }) {
  return (
    <section className="panel">
      <PanelHead title="Build / Deploy" note="Prepare and export the deployable player bundle." />
      <div className="action-row">
        <button className="btn" onClick={() => void onPrepare(false)}>Preview build</button>
        <button className="btn btn--primary" onClick={() => void onPrepare(true)}>Export .game.json</button>
      </div>
      <pre className="output">{build ? JSON.stringify(build.build ?? build, null, 2) : "No build prepared."}</pre>
    </section>
  );
}

function SettingsPanel({ editor, onRefresh, onStatus }) {
  const [title, setTitle] = useState(editor?.metadata?.title ?? "");
  const [plan, setPlan] = useState("");
  const [provider, setProvider] = useState("stub");
  const [theme, setTheme] = useState("small kingdom");
  const [count, setCount] = useState(8);

  useEffect(() => setTitle(editor?.metadata?.title ?? ""), [editor?.metadata?.title]);

  async function saveTitle() {
    await api("/api/editor/metadata", { method: "PATCH", body: { metadata: { title } } });
    onStatus("Project title saved");
    await onRefresh();
  }

  async function buildPlan() {
    const result = await api("/api/connector/plan", {
      method: "POST",
      body: { config: { provider, theme, cardCount: count } }
    });
    setPlan(JSON.stringify(result, null, 2));
  }

  return (
    <section className="panel">
      <PanelHead title="Settings / Pipeline" note="Project metadata, skin posture, locale hooks, and connector planning." />
      <div className="subsection">
        <h3>Project</h3>
        <div className="field-row">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Deck title" />
          <button className="btn" onClick={() => void saveTitle()}>Save title</button>
        </div>
      </div>
      <div className="subsection">
        <h3>Connector Plan</h3>
        <div className="field-row field-row--compact">
          <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="provider" />
          <input value={theme} onChange={(event) => setTheme(event.target.value)} placeholder="theme" />
          <input type="number" min="1" value={count} onChange={(event) => setCount(Number(event.target.value))} />
          <button className="btn btn--primary" onClick={() => void buildPlan()}>Build plan</button>
        </div>
        <pre className="output">{plan || "No connector plan generated."}</pre>
      </div>
    </section>
  );
}

function PanelHead({ title, note }) {
  return (
    <div className="panel-head">
      <div>
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "" }) {
  return (
    <div className={`metric ${tone ? `metric--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function panelStatus(id, { editor, playerReady, diagnostics, build }) {
  if (id === "overview") return editor ? "ready" : "loading";
  if (id === "content") return `${editor?.cards?.length ?? 0}`;
  if (id === "story") return `${editor?.cards?.length ?? 0}`;
  if (id === "review") return diagnostics ? `${diagnostics.healthScore}` : "new";
  if (id === "preview") return playerReady ? "ready" : "blocked";
  if (id === "build") return build ? "ready" : "new";
  if (id === "settings") return editor?.metadata?.title ? "set" : "new";
  return "";
}

function choicePath(cardId, choiceId) {
  return `/api/editor/cards/${encodeURIComponent(cardId)}/choices/${encodeURIComponent(choiceId)}`;
}

function effectPath(cardId, choiceId, kind, target) {
  return `${choicePath(cardId, choiceId)}/effects/${kind}/${encodeURIComponent(target)}`;
}

function readStoredDraft() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry?.bundle || !Array.isArray(entry.bundle.cards)) return null;
    return entry;
  } catch {
    return null;
  }
}

function readDraftInfo() {
  const draft = readStoredDraft();
  if (!draft) return null;
  return {
    savedAt: draft.savedAt,
    cardCount: draft.cardCount ?? draft.bundle.cards.length
  };
}

function clearStoredDraft() {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(DRAFT_KEY);
  }
}

function formatDraftTime(savedAt) {
  if (!savedAt) return "unknown time";
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return date.toLocaleString();
}

function cardValidationState(editor, card, index) {
  const messages = [];
  const seen = new Set();
  const append = (items = [], level) => {
    for (const text of items) {
      if (!messageBelongsToCard(String(text), card, index)) continue;
      const key = `${level}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push({ level, text });
    }
  };

  append(editor?.validation?.errors, "error");
  append(editor?.playerValidation?.errors, "error");
  append(editor?.validation?.warnings, "warning");
  append(editor?.playerValidation?.warnings, "warning");

  return {
    invalid: messages.some((message) => message.level === "error"),
    messages
  };
}

function messageBelongsToCard(message, card, index) {
  return (
    message.includes(`Card at index ${index}`) ||
    message.includes(`Card '${card.id}'`) ||
    message.includes(`card '${card.id}'`) ||
    message.includes(`card id '${card.id}'`)
  );
}

function matchesCardQuery(card, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    card.id,
    card.text,
    ...(card.choices ?? []).flatMap((choice) => [choice.id, choice.label])
  ].join(" ").toLowerCase();
  return haystack.includes(normalized);
}

function createFactionDraft(factions = {}) {
  return Object.fromEntries(FACTIONS.map((faction) => {
    const delta = factions?.[faction];
    return [faction, delta === undefined ? "" : String(delta)];
  }));
}

function parseTagValue(text) {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "false") return null;
  if (trimmed === "true") return true;
  return trimmed;
}

function parseScalar(text) {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const number = Number(trimmed);
  if (Number.isFinite(number)) return number;
  return trimmed;
}

function formatEffectValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function cardExcerpt(card) {
  const text = (card.text ?? "").trim();
  if (!text) return "No card text";
  return text.length > 72 ? `${text.slice(0, 72)}...` : text;
}

function createAssetMap(assets) {
  const map = new Map();
  for (const asset of assets) {
    if (asset?.cardId) map.set(asset.cardId, asset);
  }
  return map;
}

createRoot(document.getElementById("root")).render(<App />);
