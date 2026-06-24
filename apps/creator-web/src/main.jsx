import React, { useEffect, useMemo, useState } from "react";
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
            />
          )}
          {activePanel === "story" && <StoryPanel editor={editor} diagnostics={diagnostics} onOpen={openPanel} />}
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

function ContentPanel({ editor, assetsByCard, onImport, onMutate, onStatus }) {
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
    if (visibleItems.length === 0) {
      setSelectedCardId(null);
      return;
    }
    if (!selectedCardId || !visibleItems.some(({ card }) => card.id === selectedCardId)) {
      setSelectedCardId(visibleItems[0].card.id);
    }
  }, [selectedCardId, visibleItems]);

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

function StoryPanel({ editor, diagnostics, onOpen }) {
  return (
    <section className="panel">
      <PanelHead title="Story / Endings" note="Global narrative structure, ending coverage, and reachability." />
      <div className="metric-grid">
        <Metric label="Narrative nodes" value={`${editor?.cards?.length ?? 0} cards`} />
        <Metric label="Endings" value="Data-authored" />
        <Metric label="Reachability" value={diagnostics ? `${diagnostics.warnings?.length ?? 0} warnings` : "Run review"} />
      </div>
      <div className="empty-state">
        <h3>Graph view next</h3>
        <p>Reviewer graph diagnostics already report unreachable cards and gated paths. This panel is reserved for a visual story graph and endings editor.</p>
        <button className="btn" onClick={() => onOpen("review")}>Open review diagnostics</button>
      </div>
    </section>
  );
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
  if (id === "story") return "planned";
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
