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
  const historyRef = useRef([]);
  const [historyDepth, setHistoryDepth] = useState(0);

  // Snapshot the editor bundle before a mutation so it can be undone.
  async function pushHistory() {
    try {
      const snapshot = await api("/api/editor/snapshot");
      const bundle = snapshot.bundle;
      if (bundle) {
        historyRef.current.push(bundle);
        if (historyRef.current.length > 50) historyRef.current.shift();
        setHistoryDepth(historyRef.current.length);
      }
    } catch {
      // Non-fatal: undo just won't cover this mutation.
    }
  }

  async function undo() {
    const bundle = historyRef.current.pop();
    setHistoryDepth(historyRef.current.length);
    if (!bundle) {
      setStatus("Nothing to undo");
      return;
    }
    await runAction("Undoing", async () => {
      await api("/api/editor/restore", { method: "POST", body: { bundle } });
      await refreshEditor({ statusMessage: "Undid last edit" });
    });
  }

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
      const target = event.target;
      const isEditable = target?.closest?.("input, textarea, select, [contenteditable='true']");
      if (isEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undo();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
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
      await pushHistory();
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
              onPushHistory={pushHistory}
              onUndo={undo}
              historyDepth={historyDepth}
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
  const tagCatalog = useTagCatalog(editor);

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
                tagCatalog={tagCatalog}
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

function CardEditor({ card, asset, validation, onMutate, onStatus, tagCatalog }) {
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
      <RequirementEditor card={card} tagCatalog={tagCatalog} onMutate={onMutate} onStatus={onStatus} />
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

/**
 * RequirementEditor edits a card's gating requirements (allTags / anyTags /
 * noneTags) with semantic labels drawn from the tag catalog. It replaces the
 * raw JSON editing path: creators pick from known tags by human name, or type a
 * new key. Changes submit the whole requirements object via PUT /api/editor/cards/:id.
 */
function RequirementEditor({ card, tagCatalog, onMutate, onStatus }) {
  const requirements = card.requirements ?? {};

  async function saveRequirements(next) {
    await onMutate(
      `Updating ${card.id} requirements`,
      async () => api(`/api/editor/cards/${encodeURIComponent(card.id)}`, {
        method: "PUT",
        body: { changes: { requirements: next } }
      }),
      `Updated ${card.id} requirements`
    );
  }

  function updateGroup(mode, nextTags) {
    const clean = nextTags.map((tag) => tag.trim()).filter(Boolean);
    const unique = [...new Set(clean)];
    const merged = { ...requirements };
    if (unique.length > 0) {
      merged[mode] = unique;
    } else {
      delete merged[mode];
    }
    void saveRequirements(merged);
  }

  const groups = [
    { mode: "allTags", heading: "Needs all of these tags", hint: "Card only appears when every tag here is set." },
    { mode: "anyTags", heading: "Needs any of these tags", hint: "Card appears when at least one tag here is set." },
    { mode: "noneTags", heading: "Blocked by these tags", hint: "Card is hidden while any of these tags is set." }
  ];

  return (
    <div className="requirement-editor">
      <div className="requirement-editor__head">
        <strong>When does this card appear?</strong>
        <span>Empty = always eligible</span>
      </div>
      {groups.map((group) => (
        <RequirementGroup
          key={group.mode}
          mode={group.mode}
          heading={group.heading}
          hint={group.hint}
          tags={requirements[group.mode] ?? []}
          tagCatalog={tagCatalog}
          onChange={(nextTags) => updateGroup(group.mode, nextTags)}
          onStatus={onStatus}
        />
      ))}
    </div>
  );
}

/**
 * TagPicker is a skin-consistent replacement for <datalist>: a text input with
 * a filtered dropdown of known tags (showing human label + raw key). Selecting
 * an option calls onPick with the key; typing a novel key still works via the
 * input. Closes on escape, blur, or pick.
 */
function TagPicker({ value, onChange, onPick, tagCatalog, placeholder, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);

  const options = useMemo(() => {
    const normalized = (value ?? "").trim().toLowerCase();
    const all = tagCatalog?.tags ?? [];
    if (!normalized) return all;
    return all.filter((entry) => (
      entry.key.toLowerCase().includes(normalized) ||
      (entry.label ?? "").toLowerCase().includes(normalized)
    ));
  }, [value, tagCatalog]);

  useEffect(() => {
    setHighlight(0);
  }, [value, open]);

  useEffect(() => {
    function onDocPointer(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    return () => document.removeEventListener("mousedown", onDocPointer);
  }, []);

  function choose(key) {
    onPick(key);
    setOpen(false);
  }

  function onKeyDown(event) {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && options[highlight]) {
      event.preventDefault();
      choose(options[highlight].key);
    }
  }

  const showCreate = value && value.trim() && !options.some((entry) => entry.key === value.trim());

  return (
    <div className="tag-picker" ref={wrapperRef}>
      <input
        ref={inputRef}
        className="tag-picker__input"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="tag-picker__menu" role="listbox">
          {options.map((entry, index) => (
            <li key={entry.key} role="option" aria-selected={index === highlight}>
              <button
                type="button"
                className={index === highlight ? "tag-picker__option tag-picker__option--active" : "tag-picker__option"}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(entry.key)}
              >
                <span className="tag-picker__label">{entry.label || entry.key}</span>
                <code className="tag-picker__key">{entry.key}</code>
              </button>
            </li>
          ))}
          {showCreate && (
            <li role="option">
              <button
                type="button"
                className="tag-picker__option tag-picker__option--create"
                onClick={() => choose(value.trim())}
              >
                <span className="tag-picker__label">Create new tag</span>
                <code className="tag-picker__key">{value.trim()}</code>
              </button>
            </li>
          )}
          {options.length === 0 && !showCreate && (
            <li className="tag-picker__empty">No matching tags. Type to create one.</li>
          )}
        </ul>
      )}
    </div>
  );
}

function RequirementGroup({ mode, heading, hint, tags, tagCatalog, onChange, onStatus }) {
  const [draft, setDraft] = useState("");

  function removeTag(tag) {
    onChange(tags.filter((existing) => existing !== tag));
  }

  function addTag() {
    const value = draft.trim();
    if (!value) return;
    if (tags.includes(value)) {
      setDraft("");
      return;
    }
    onChange([...tags, value]);
    setDraft("");
  }

  return (
    <div className="requirement-group">
      <div className="requirement-group__head">
        <span>{heading}</span>
        <small>{hint}</small>
      </div>
      <div className="requirement-chips">
        {tags.map((tag) => (
          <span key={tag} className="requirement-chip">
            <span className="requirement-chip__label">{tagDisplayName(tag, tagCatalog.byKey)}</span>
            <code className="requirement-chip__key">{tag}</code>
            <button
              className="requirement-chip__remove"
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => removeTag(tag)}
            >x</button>
          </span>
        ))}
        {tags.length === 0 && <span className="empty-inline">No {mode} requirement</span>}
      </div>
      <div className="requirement-add">
        <TagPicker
          value={draft}
          onChange={setDraft}
          onPick={(key) => { onChange([...tags.filter((existing) => existing !== key), key]); setDraft(""); }}
          tagCatalog={tagCatalog}
          placeholder="Pick or type a tag key"
        />
        <button className="btn btn--ghost" type="button" disabled={!draft.trim()} onClick={() => addTag()}>Add</button>
      </div>
    </div>
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

function StoryPanel({ editor, diagnostics, onOpen, onFocusCard, onPushHistory, onUndo, historyDepth = 0 }) {
  const [graph, setGraph] = useState(null);
  const [graphError, setGraphError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [renaming, setRenaming] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const tagCatalog = useTagCatalog(editor);

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

  useEffect(() => {
    if (!fullscreen) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") setFullscreen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  async function saveTagLabel(key, label) {
    await onPushHistory?.();
    const tagLabels = { ...(editor?.metadata?.tagLabels ?? {}) };
    if (label.trim()) {
      tagLabels[key] = label.trim();
    } else {
      delete tagLabels[key];
    }
    await api("/api/editor/metadata", { method: "PATCH", body: { metadata: { tagLabels } } });
    setRenaming(null);
  }

  return (
    <section className="panel panel--story">
      <PanelHead title="Story / Graph" note="Card-to-card transitions driven by tags. Click a node to edit it; rename tags for clarity." />
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
          label="Tags"
          value={String(tagCatalog.tags?.length ?? 0)}
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
          <div className="story-layout">
            <StoryGraph
              graph={graph}
              cards={editor?.cards ?? []}
              onFocusCard={onFocusCard}
              tagCatalog={tagCatalog}
              onConnect={createConnection}
              onDisconnect={deleteConnection}
              onUndo={onUndo}
              historyDepth={historyDepth}
              fullscreen={fullscreen}
              onToggleFullscreen={() => setFullscreen((value) => !value)}
            />
            <TagDirectory
              tags={tagCatalog.tags ?? []}
              renaming={renaming}
              onRename={setRenaming}
              onSaveLabel={saveTagLabel}
            />
          </div>
        )
      ) : (
        <div className="empty-state">
          <p>Building story graph...</p>
        </div>
      )}
    </section>
  );

  async function createConnection({ fromCardId, choiceId, toCardId, tagKey }) {
    await onPushHistory?.();
    // Set the tag on the source choice's effects...
    const sourceCard = editor?.cards?.find((card) => card.id === fromCardId);
    if (!sourceCard) return;
    const choice = sourceCard.choices?.find((item) => item.id === choiceId);
    if (!choice) return;
    const effects = { ...(choice.effects ?? {}) };
    effects.tags = { ...(effects.tags ?? {}), [tagKey]: true };
    await api(`/api/editor/cards/${encodeURIComponent(fromCardId)}/choices/${encodeURIComponent(choiceId)}`, {
      method: "PATCH",
      body: { effects }
    });
    // ...and add it to the target card's allTags requirement.
    const targetCard = editor?.cards?.find((card) => card.id === toCardId);
    if (targetCard) {
      const requirements = { ...(targetCard.requirements ?? {}) };
      const existing = requirements.allTags ?? [];
      if (!existing.includes(tagKey)) {
        requirements.allTags = [...existing, tagKey];
        await api(`/api/editor/cards/${encodeURIComponent(toCardId)}`, {
          method: "PUT",
          body: { changes: { requirements } }
        });
      }
    }
    setRefreshKey((value) => value + 1);
  }

  async function deleteConnection(edge) {
    const { from: fromCardId, to: toCardId, tags = [], choices = [] } = edge;
    const tagKey = tags[0];
    if (!tagKey) return;
    await onPushHistory?.();
    const choiceIds = choices.map((choice) => choice.id);

    // Remove the tag from each producing choice on the source card.
    const sourceCard = editor?.cards?.find((card) => card.id === fromCardId);
    if (sourceCard) {
      for (const choice of sourceCard.choices ?? []) {
        if (choiceIds.length > 0 && !choiceIds.includes(choice.id)) continue;
        const tags = choice.effects?.tags ?? {};
        if (!(tagKey in tags)) continue;
        await api(`${choicePath(fromCardId, choice.id)}/effects/tag/${encodeURIComponent(tagKey)}`, {
          method: "DELETE"
        });
      }
    }

    // Remove the tag from the target card's requirements (all/any/none).
    const targetCard = editor?.cards?.find((card) => card.id === toCardId);
    if (targetCard) {
      const requirements = { ...(targetCard.requirements ?? {}) };
      let changed = false;
      for (const mode of ["allTags", "anyTags", "noneTags"]) {
        const existing = requirements[mode];
        if (Array.isArray(existing) && existing.includes(tagKey)) {
          const next = existing.filter((tag) => tag !== tagKey);
          if (next.length > 0) requirements[mode] = next;
          else delete requirements[mode];
          changed = true;
        }
      }
      if (changed) {
        await api(`/api/editor/cards/${encodeURIComponent(toCardId)}`, {
          method: "PUT",
          body: { changes: { requirements } }
        });
      }
    }
    setRefreshKey((value) => value + 1);
  }
}

function TagDirectory({ tags, renaming, onRename, onSaveLabel }) {
  if (tags.length === 0) {
    return (
      <aside className="tag-directory">
        <div className="tag-directory__head">
          <strong>Story tags</strong>
        </div>
        <p className="muted">No tags yet. They appear once cards set or require them.</p>
      </aside>
    );
  }
  return (
    <aside className="tag-directory">
      <div className="tag-directory__head">
        <strong>Story tags</strong>
        <small>{tags.length}</small>
      </div>
      <ul className="tag-directory__list">
        {tags.map((entry) => (
          <li key={entry.key} className="tag-directory__item">
            {renaming === entry.key ? (
              <TagRenameRow
                entry={entry}
                onSave={(label) => onSaveLabel(entry.key, label)}
                onCancel={() => onRename(null)}
              />
            ) : (
              <>
                <div className="tag-directory__meta">
                  <span className="tag-directory__label">{entry.label || entry.key}</span>
                  {!entry.label && <code className="tag-directory__key">{entry.key}</code>}
                </div>
                <small className="tag-directory__counts">
                  {entry.producedBy.length} out · {entry.requiredBy.length} in
                </small>
                <button
                  className="btn btn--ghost btn--compact"
                  type="button"
                  onClick={() => onRename(entry.key)}
                >Rename</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function TagRenameRow({ entry, onSave, onCancel }) {
  const [label, setLabel] = useState(entry.label ?? "");
  useEffect(() => setLabel(entry.label ?? ""), [entry.key, entry.label]);
  return (
    <div className="tag-rename">
      <code className="tag-directory__key">{entry.key}</code>
      <input
        autoFocus
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSave(label);
          if (event.key === "Escape") onCancel();
        }}
        placeholder="Human label (e.g. 粮仓已开)"
      />
      <button className="btn btn--compact" type="button" onClick={() => onSave(label)}>Save</button>
      <button className="btn btn--ghost btn--compact" type="button" onClick={onCancel}>Cancel</button>
    </div>
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
function StoryGraph({
  graph,
  cards,
  onFocusCard,
  tagCatalog,
  onConnect,
  onDisconnect,
  onUndo,
  historyDepth = 0,
  fullscreen = false,
  onToggleFullscreen
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const layoutRef = useRef({
    nodes: [],
    byId: new Map(),
    pan: { x: 0, y: 0 },
    zoom: 1,
    hover: null,
    connect: null
  });
  const animationRef = useRef(0);
  const [tooltip, setTooltip] = useState(null);
  const [pendingConnect, setPendingConnect] = useState(null);
  const [hoverEdge, setHoverEdge] = useState(null);
  const [disconnectButton, setDisconnectButton] = useState(null);

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
    layoutRef.current.zoom = 1;
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
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const zoom = layoutRef.current.zoom;
      const cx = width / 2 + layoutRef.current.pan.x;
      const cy = height / 2 + layoutRef.current.pan.y;
      const screenPoint = (node) => ({
        x: cx + node.x * zoom,
        y: cy + node.y * zoom
      });

      // Edges first so nodes render on top.
      for (const edge of graph.edges) {
        const from = layoutRef.current.byId.get(edge.from);
        const to = layoutRef.current.byId.get(edge.to);
        if (!from || !to) continue;
        const fromPoint = screenPoint(from);
        const toPoint = screenPoint(to);
        const x1 = fromPoint.x;
        const y1 = fromPoint.y;
        const x2 = toPoint.x;
        const y2 = toPoint.y;
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

        // Choice badges (L/R) at edge midpoint, with semantic tag label.
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const choiceIds = (edge.choices ?? []).map((choice) => choice.id);
        const tagKey = (edge.tags ?? [])[0];
        const tagLabel = tagKey ? tagDisplayName(tagKey, tagCatalog?.byKey) : null;
        const isHoverEdge = hoverEdgeRef.current?.key === `${edge.from}->${edge.to}`;
        if (isHoverEdge) {
          // Highlight the whole edge when hovered.
          ctx.strokeStyle = colors.accent2;
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (choiceIds.length > 0) {
          drawChoiceBadge(ctx, midX, midY, choiceIds, colors);
        }
        if (tagLabel) {
          drawEdgeLabel(ctx, midX, midY + 14, tagLabel, colors);
        }
      }

      // Nodes.
      for (const node of layoutRef.current.nodes) {
        const { x, y } = screenPoint(node);
        const tone = nodeTone.get(node.id) ?? "reachable";
        const fill = toneFill(tone, colors);
        const stroke = toneStroke(tone, colors);
        const isHover = layoutRef.current.hover === node.id;
        const isConnectTarget = layoutRef.current.connect && layoutRef.current.hover === node.id && layoutRef.current.connect.from !== node.id;

        ctx.beginPath();
        ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = tone === "unreachable" || tone === "isolated" ? 2 : isHover ? 2.5 : 1.5;
        if (tone === "unreachable" || tone === "isolated") ctx.setLineDash([4, 3]);
        ctx.strokeStyle = isConnectTarget ? colors.accent2 : isHover ? colors.accent : stroke;
        ctx.stroke();
        ctx.setLineDash([]);

        // Choice handles (L/R) appear on hover; dragging from a handle starts a
        // connection to another node.
        if (isHover) {
          drawChoiceHandle(ctx, x - NODE_RADIUS, y, "L", colors);
          drawChoiceHandle(ctx, x + NODE_RADIUS, y, "R", colors);
        }

        // Label: card id, truncated.
        ctx.fillStyle = colors.ink;
        ctx.font = "600 11px var(--font-data, monospace)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const label = node.id.length > 14 ? `${node.id.slice(0, 13)}…` : node.id;
        ctx.fillText(label, x, y + NODE_RADIUS + 4);
      }

      // Connection drag preview.
      if (layoutRef.current.connect) {
        const fromNode = layoutRef.current.byId.get(layoutRef.current.connect.from);
        const hoverId = layoutRef.current.hover;
        const toX = hoverId && hoverId !== layoutRef.current.connect.from
          ? screenPoint(layoutRef.current.byId.get(hoverId)).x
          : layoutRef.current.connect.toX;
        const toY = hoverId && hoverId !== layoutRef.current.connect.from
          ? screenPoint(layoutRef.current.byId.get(hoverId)).y
          : layoutRef.current.connect.toY;
        if (fromNode) {
          const fromPoint = screenPoint(fromNode);
          ctx.strokeStyle = colors.accent2;
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(fromPoint.x, fromPoint.y);
          ctx.lineTo(toX, toY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
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
  }, [graph, nodeTone, colors, tagCatalog]);

  // Keep the hovered edge in a ref so the render loop reads it without re-running.
  const hoverEdgeRef = useRef(null);
  useEffect(() => { hoverEdgeRef.current = hoverEdge; }, [hoverEdge]);

  useEffect(() => {
    if (!hoverEdge) setDisconnectButton(null);
  }, [hoverEdge]);

  useEffect(() => {
    window.dispatchEvent(new Event("resize"));
  }, [fullscreen]);

  // Pointer interaction: hover + click + pan + drag-to-connect.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph) return;
    let panning = false;
    let panStart = null;

    function pointer(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function center() {
      return {
        cx: canvas.getBoundingClientRect().width / 2 + layoutRef.current.pan.x,
        cy: canvas.getBoundingClientRect().height / 2 + layoutRef.current.pan.y,
        zoom: layoutRef.current.zoom
      };
    }

    function nodeAt(point) {
      const { cx, cy, zoom } = center();
      for (const node of layoutRef.current.nodes) {
        const nx = cx + node.x * zoom;
        const ny = cy + node.y * zoom;
        const dx = point.x - nx;
        const dy = point.y - ny;
        if (dx * dx + dy * dy <= (NODE_RADIUS + 4) * (NODE_RADIUS + 4)) return node.id;
      }
      return null;
    }

    // Returns { nodeId, choiceId } if the point sits on a choice handle, else null.
    function handleAt(point) {
      const { cx, cy, zoom } = center();
      const node = layoutRef.current.byId.get(layoutRef.current.hover);
      if (!node) return null;
      const nx = cx + node.x * zoom;
      const ny = cy + node.y * zoom;
      const handles = [
        { choiceId: "left", x: nx - NODE_RADIUS, y: ny },
        { choiceId: "right", x: nx + NODE_RADIUS, y: ny }
      ];
      for (const handle of handles) {
        const dx = point.x - handle.x;
        const dy = point.y - handle.y;
        if (dx * dx + dy * dy <= 8 * 8) return { nodeId: node.id, choiceId: handle.choiceId };
      }
      return null;
    }

    function edgeMetrics(edge) {
      const { cx, cy, zoom } = center();
      const from = layoutRef.current.byId.get(edge.from);
      const to = layoutRef.current.byId.get(edge.to);
      if (!from || !to) return null;
      const fromX = cx + from.x * zoom;
      const fromY = cy + from.y * zoom;
      const toX = cx + to.x * zoom;
      const toY = cy + to.y * zoom;
      const midX = (fromX + toX) / 2;
      const midY = (fromY + toY) / 2;
      const angle = Math.atan2(toY - fromY, toX - fromX);
      const tipX = toX - Math.cos(angle) * (NODE_RADIUS + 2);
      const tipY = toY - Math.sin(angle) * (NODE_RADIUS + 2);
      return { midX, midY, tipX, tipY };
    }

    // Returns the edge whose choice badge or arrowhead is under the pointer.
    // It only reveals the explicit delete button; clicks on the graph itself
    // never delete.
    function edgeActionAt(point) {
      for (const edge of graph.edges) {
        const metrics = edgeMetrics(edge);
        if (!metrics) continue;
        const badgeDx = point.x - metrics.midX;
        const badgeDy = point.y - metrics.midY;
        const arrowDx = point.x - metrics.tipX;
        const arrowDy = point.y - metrics.tipY;
        const overBadge = Math.abs(badgeDx) <= 34 && Math.abs(badgeDy) <= 14;
        const overArrow = arrowDx * arrowDx + arrowDy * arrowDy <= 16 * 16;
        if (overBadge || overArrow) {
          return {
            edge,
            buttonX: overBadge ? metrics.midX : metrics.tipX,
            buttonY: (overBadge ? metrics.midY : metrics.tipY) - 24
          };
        }
      }
      return null;
    }

    function onMove(event) {
      const point = pointer(event);

      // Connection drag in progress: follow the cursor.
      if (layoutRef.current.connect) {
        layoutRef.current.connect.toX = point.x;
        layoutRef.current.connect.toY = point.y;
        const hoverId = nodeAt(point);
        if (hoverId !== layoutRef.current.hover) layoutRef.current.hover = hoverId;
        return;
      }

      if (panning) {
        layoutRef.current.pan.x += point.x - panStart.x;
        layoutRef.current.pan.y += point.y - panStart.y;
        panStart = point;
        return;
      }
      const id = nodeAt(point);
      if (id !== layoutRef.current.hover) {
        layoutRef.current.hover = id;
        setHoverEdge(null);
        const handle = id ? handleAt(point) : null;
        canvas.style.cursor = handle ? "crosshair" : id ? "pointer" : "grab";
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
        const handle = handleAt(point);
        canvas.style.cursor = handle ? "crosshair" : "pointer";
        setTooltip((current) => (current ? { ...current, x: point.x, y: point.y } : current));
      } else {
        const action = edgeActionAt(point);
        const edgeKey = action ? `${action.edge.from}->${action.edge.to}` : null;
        setHoverEdge((current) => (current?.key === edgeKey ? current : action ? { key: edgeKey, edge: action.edge } : null));
        setDisconnectButton(action ? { edge: action.edge, x: action.buttonX, y: action.buttonY } : null);
        canvas.style.cursor = action ? "default" : "grab";
      }
    }

    function onWheel(event) {
      event.preventDefault();
      const point = pointer(event);
      const rect = canvas.getBoundingClientRect();
      const cx = rect.width / 2 + layoutRef.current.pan.x;
      const cy = rect.height / 2 + layoutRef.current.pan.y;
      const currentZoom = layoutRef.current.zoom;
      const nextZoom = Math.min(3, Math.max(0.3, currentZoom * (event.deltaY > 0 ? 0.9 : 1.1)));
      if (nextZoom === currentZoom) return;
      const graphX = (point.x - cx) / currentZoom;
      const graphY = (point.y - cy) / currentZoom;
      layoutRef.current.pan.x = point.x - rect.width / 2 - graphX * nextZoom;
      layoutRef.current.pan.y = point.y - rect.height / 2 - graphY * nextZoom;
      layoutRef.current.zoom = nextZoom;
    }

    function onDown(event) {
      const point = pointer(event);

      // Start a connection drag from a choice handle.
      const handle = handleAt(point);
      if (handle) {
        layoutRef.current.connect = {
          from: handle.nodeId,
          choiceId: handle.choiceId,
          toX: point.x,
          toY: point.y
        };
        setTooltip(null);
        canvas.style.cursor = "crosshair";
        return;
      }

      const id = nodeAt(point);
      if (!id) {
        if (edgeActionAt(point)) return;
        panning = true;
        panStart = point;
        canvas.style.cursor = "grabbing";
      }
    }

    function onUp(event) {
      // Finish a connection drag.
      if (layoutRef.current.connect) {
        const targetId = nodeAt(pointer(event));
        const connect = layoutRef.current.connect;
        layoutRef.current.connect = null;
        canvas.style.cursor = "grab";
        if (targetId && targetId !== connect.from) {
          setPendingConnect({
            fromCardId: connect.from,
            choiceId: connect.choiceId,
            toCardId: targetId
          });
        }
        return;
      }

      if (panning) {
        panning = false;
        canvas.style.cursor = "grab";
        panStart = null;
        return;
      }
      const point = pointer(event);
      const id = nodeAt(point);
      if (id) {
        setTooltip(null);
        onFocusCard?.(id);
        return;
      }
    }

    function onLeave(event) {
      panning = false;
      panStart = null;
      layoutRef.current.hover = null;
      layoutRef.current.connect = null;
      if (containerRef.current?.contains(event.relatedTarget)) return;
      setHoverEdge(null);
      setDisconnectButton(null);
      canvas.style.cursor = "default";
      setTooltip(null);
    }

    canvas.style.cursor = "grab";
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onLeave);
    return () => {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [graph, cardById, nodeTone, onFocusCard, onDisconnect]);

  return (
    <div className={fullscreen ? "graph-container graph-container--fullscreen" : "graph-container"} ref={containerRef}>
      <canvas ref={canvasRef} className="graph-canvas" />
      <div className="graph-toolbar">
        <button
          className="graph-icon-btn graph-undo"
          type="button"
          disabled={historyDepth === 0}
          title={`Undo (${historyDepth})`}
          aria-label={`Undo (${historyDepth})`}
          onClick={() => onUndo?.()}
        >
          <UndoIcon />
          <span>{historyDepth}</span>
        </button>
        <button
          className="graph-icon-btn graph-fullscreen-btn"
          type="button"
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => onToggleFullscreen?.()}
        >
          {fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
        </button>
      </div>
      {disconnectButton && (
        <button
          className="graph-edge-delete"
          type="button"
          title="Delete connection"
          aria-label="Delete connection"
          style={{ left: disconnectButton.x, top: disconnectButton.y }}
          onMouseEnter={() => {
            const edge = disconnectButton.edge;
            setHoverEdge({ key: `${edge.from}->${edge.to}`, edge });
          }}
          onClick={() => {
            const edge = disconnectButton.edge;
            setHoverEdge(null);
            setDisconnectButton(null);
            onDisconnect?.(edge);
          }}
        >
          <DeleteXIcon />
        </button>
      )}
      {tooltip && (
        <div className="graph-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <strong>{tooltip.id}</strong>
          {tooltip.text && <p>{tooltip.text}</p>}
          <small className={`graph-tooltip__tone graph-tooltip__tone--${tooltip.tone}`}>{tooltip.tone}</small>
          <small>{tooltip.incoming} in · {tooltip.outgoing} out</small>
          <small className="graph-tooltip__hint">Drag L/R handles to connect · click to edit</small>
        </div>
      )}
      {pendingConnect && (
        <ConnectDialog
          pending={pendingConnect}
          tagCatalog={tagCatalog}
          onCancel={() => setPendingConnect(null)}
          onConfirm={(tagKey) => {
            const request = pendingConnect;
            setPendingConnect(null);
            onConnect?.({ ...request, tagKey });
          }}
        />
      )}
    </div>
  );
}

/**
 * ConnectDialog confirms a drag-to-connect: it asks which tag should wire the
 * two cards together, defaulting to a suggested camelCase key. The creator can
 * pick an existing tag or type a new one.
 */
function ConnectDialog({ pending, tagCatalog, onCancel, onConfirm }) {
  const suggested = `${pending.fromCardId.replace(/[^a-z0-9]/gi, "")}_${pending.choiceId}`;
  const [tagKey, setTagKey] = useState(suggested);
  useEffect(() => setTagKey(suggested), [suggested]);

  return (
    <div className="connect-dialog">
      <strong>Connect cards</strong>
      <p>
        <code>{pending.fromCardId}</code> · <em>{pending.choiceId}</em> swipe
        <span className="connect-dialog__arrow">→</span>
        unlocks <code>{pending.toCardId}</code>
      </p>
      <label className="connect-dialog__label">Tag that links them</label>
      <TagPicker
        value={tagKey}
        onChange={setTagKey}
        onPick={(key) => setTagKey(key)}
        tagCatalog={tagCatalog}
        placeholder="Pick or type a tag key"
        autoFocus
      />
      <div className="connect-dialog__actions">
        <button className="btn" type="button" disabled={!tagKey.trim()} onClick={() => onConfirm(tagKey.trim())}>Connect</button>
        <button className="btn btn--ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function GraphIcon({ children }) {
  return (
    <svg className="graph-icon" viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

function UndoIcon() {
  return (
    <GraphIcon>
      <path d="M9 8H4V3" />
      <path d="M4 8c2-3 5-4.5 8.5-4.5A7.5 7.5 0 1 1 6 14" />
    </GraphIcon>
  );
}

function MaximizeIcon() {
  return (
    <GraphIcon>
      <path d="M8 3H3v5" />
      <path d="M16 3h5v5" />
      <path d="M21 16v5h-5" />
      <path d="M3 16v5h5" />
    </GraphIcon>
  );
}

function MinimizeIcon() {
  return (
    <GraphIcon>
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M20 15h-5v5" />
      <path d="M4 15h5v5" />
    </GraphIcon>
  );
}

function DeleteXIcon() {
  return (
    <GraphIcon>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 8.5l7 7" />
      <path d="M15.5 8.5l-7 7" />
    </GraphIcon>
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

function drawEdgeLabel(ctx, x, y, text, colors) {
  ctx.font = "500 10px var(--font-data, monospace)";
  const metrics = ctx.measureText(text);
  const padding = 5;
  const w = metrics.width + padding * 2;
  const h = 14;
  ctx.fillStyle = colors.bg;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 3);
  } else {
    ctx.rect(x - w / 2, y - h / 2, w, h);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function drawChoiceHandle(ctx, x, y, label, colors) {
  const r = 7;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = colors.surface;
  ctx.fill();
  ctx.strokeStyle = colors.accent2;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = colors.accent2;
  ctx.font = "700 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);
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

/**
 * useTagCatalog fetches the derived tag directory from /api/editor/tags and
 * refetches whenever the editor revision changes (after any card mutation).
 * Returns { tags, byKey, loading, error }. `byKey` is a Map for quick lookup
 * when rendering semantic labels for requirement editors and graph edges.
 */
function useTagCatalog(editor) {
  const [catalog, setCatalog] = useState({ tags: [], byKey: new Map() });
  const [error, setError] = useState("");
  const editorRevision = editor?.cards?.length ?? 0;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api("/api/editor/tags");
        if (cancelled) return;
        const byKey = new Map(result.tags.map((entry) => [entry.key, entry]));
        setCatalog({ tags: result.tags ?? [], byKey });
        setError("");
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError.message);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [editorRevision]);

  return { ...catalog, error };
}

/**
 * tagDisplayName resolves a tag key to its human label, falling back to the raw
 * key when no label is set. Used everywhere a raw key would otherwise show.
 */
function tagDisplayName(key, byKey) {
  const entry = byKey?.get(key);
  return entry?.label || key;
}

createRoot(document.getElementById("root")).render(<App />);
