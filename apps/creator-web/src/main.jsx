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
  ["arcade", "Arcade"],
  ["terminal", "Terminal"]
];

const PERSIST_KEY = "reigns-agent.creator-web.skin";

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
  const [activePanel, setActivePanel] = useState("overview");
  const [editor, setEditor] = useState(null);
  const [status, setStatus] = useState("Loading project...");
  const [skin, setSkin] = useState(() => localStorage.getItem(PERSIST_KEY) || "workbench");
  const [diagnostics, setDiagnostics] = useState(null);
  const [play, setPlay] = useState({ sessionId: null, state: null });
  const [build, setBuild] = useState(null);
  const [busy, setBusy] = useState("");

  const assetsByCard = useMemo(() => createAssetMap(editor?.assets ?? []), [editor]);
  const playerReady = editor?.playerValidation?.valid === true;
  const activePanelLabel = PANELS.find((panel) => panel.id === activePanel)?.label ?? "Workspace";

  useEffect(() => {
    document.documentElement.dataset.skin = skin;
    localStorage.setItem(PERSIST_KEY, skin);
  }, [skin]);

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

  async function refreshEditor() {
    const next = await api("/api/editor");
    setEditor(next);
    setStatus(`${next.cards.length} cards loaded`);
  }

  async function runAction(label, action) {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy("");
    }
  }

  async function importBundle(bundle) {
    await api("/api/editor/import", { method: "POST", body: { bundle } });
    await refreshEditor();
    setStatus("Content imported");
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
            <select value={skin} onChange={(event) => setSkin(event.target.value)}>
              {SKINS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <a className="link-button" href="/play">Player</a>
        </div>
      </header>

      <div className="workspace">
        <nav className="rail" aria-label="Creator panels">
          {PANELS.map(({ id, label, group }, index) => (
            <button
              key={id}
              className={activePanel === id ? "rail__item rail__item--active" : "rail__item"}
              type="button"
              onClick={() => setActivePanel(id)}
            >
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
          {activePanel === "overview" && (
            <Overview
              editor={editor}
              playerReady={playerReady}
              diagnostics={diagnostics}
              build={build}
              onOpen={setActivePanel}
            />
          )}
          {activePanel === "content" && (
            <ContentPanel
              editor={editor}
              assetsByCard={assetsByCard}
              onRefresh={refreshEditor}
              onImport={importBundle}
              onStatus={setStatus}
            />
          )}
          {activePanel === "story" && <StoryPanel editor={editor} diagnostics={diagnostics} onOpen={setActivePanel} />}
          {activePanel === "review" && <ReviewPanel diagnostics={diagnostics} onRun={runDiagnostics} onOpen={setActivePanel} />}
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

function ContentPanel({ editor, assetsByCard, onRefresh, onImport, onStatus }) {
  const [paste, setPaste] = useState("");

  async function loadSample() {
    const sample = await api("/api/samples/oss-court");
    await onImport(sample);
  }

  async function importPasted() {
    await onImport(JSON.parse(paste));
    setPaste("");
  }

  async function importFile(file) {
    if (!file) return;
    const text = await file.text();
    await onImport(JSON.parse(text));
  }

  return (
    <section className="panel">
      <PanelHead title="Content / Cards" note="Card text, left/right choices, faction effects, tags, variables, and art bindings." />
      <div className="tool-strip">
        <label className="file-button">
          <input type="file" accept=".json,application/json" onChange={(event) => void importFile(event.target.files?.[0])} />
          Import JSON
        </label>
        <button className="btn" onClick={() => void loadSample()}>Load sample deck</button>
        <span className="muted">{editor?.cards?.length ?? 0} cards</span>
      </div>
      <textarea
        className="json-paste"
        value={paste}
        onChange={(event) => setPaste(event.target.value)}
        placeholder="Paste content bundle JSON"
        rows={4}
      />
      <button className="btn btn--primary" disabled={!paste.trim()} onClick={() => void importPasted()}>Import pasted JSON</button>
      <div className="card-list">
        {(editor?.cards ?? []).map((card) => (
          <CardEditor
            key={card.id}
            card={card}
            asset={assetsByCard.get(card.id)}
            onRefresh={onRefresh}
            onStatus={onStatus}
          />
        ))}
      </div>
      <AddCard onRefresh={onRefresh} onStatus={onStatus} />
    </section>
  );
}

function CardEditor({ card, asset, onRefresh, onStatus }) {
  const [text, setText] = useState(card.text ?? "");

  useEffect(() => setText(card.text ?? ""), [card.id, card.text]);

  async function saveText() {
    await api(`/api/editor/cards/${encodeURIComponent(card.id)}`, {
      method: "PUT",
      body: { changes: { text } }
    });
    onStatus(`Saved ${card.id}`);
    await onRefresh();
  }

  async function removeCard() {
    await api(`/api/editor/cards/${encodeURIComponent(card.id)}`, { method: "DELETE" });
    onStatus(`Deleted ${card.id}`);
    await onRefresh();
  }

  return (
    <article className="card-editor">
      <div className="card-editor__head">
        {asset ? <img src={`/${asset.uri}`} alt="" /> : <span className="art-placeholder" />}
        <div>
          <strong>{card.id}</strong>
          <p>{(card.choices ?? []).map((choice) => choice.id).join(" / ")}</p>
        </div>
        <button className="icon-button" title="Delete card" onClick={() => void removeCard()}>×</button>
      </div>
      <div className="field-row">
        <input value={text} onChange={(event) => setText(event.target.value)} />
        <button className="btn" onClick={() => void saveText()}>Save</button>
      </div>
      <div className="choice-grid">
        {(card.choices ?? []).map((choice) => (
          <ChoiceEditor key={choice.id} cardId={card.id} choice={choice} onRefresh={onRefresh} onStatus={onStatus} />
        ))}
      </div>
    </article>
  );
}

function ChoiceEditor({ cardId, choice, onRefresh, onStatus }) {
  const [label, setLabel] = useState(choice.label ?? "");
  const [advanced, setAdvanced] = useState(JSON.stringify(choice.effects ?? {}, null, 2));

  useEffect(() => {
    setLabel(choice.label ?? "");
    setAdvanced(JSON.stringify(choice.effects ?? {}, null, 2));
  }, [choice.id, choice.label, choice.effects]);

  async function saveLabel() {
    await api(choicePath(cardId, choice.id), { method: "PATCH", body: { label } });
    onStatus(`Saved ${choice.id} label`);
    await onRefresh();
  }

  async function setFaction(faction, value) {
    const path = `${choicePath(cardId, choice.id)}/effects/faction/${faction}`;
    if (value === "") {
      await api(path, { method: "DELETE" });
    } else {
      await api(path, { method: "POST", body: { value: Number(value) } });
    }
    onStatus(`Updated ${choice.id} ${faction}`);
    await onRefresh();
  }

  async function saveEffects() {
    await api(choicePath(cardId, choice.id), { method: "PATCH", body: { effects: JSON.parse(advanced) } });
    onStatus(`Saved ${choice.id} effects`);
    await onRefresh();
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
              defaultValue={choice.effects?.factions?.[faction] ?? ""}
              onBlur={(event) => void setFaction(faction, event.target.value)}
            />
          </label>
        ))}
      </div>
      <details>
        <summary>Advanced effects JSON</summary>
        <textarea value={advanced} onChange={(event) => setAdvanced(event.target.value)} rows={5} />
        <button className="btn" onClick={() => void saveEffects()}>Save effects JSON</button>
      </details>
    </div>
  );
}

function AddCard({ onRefresh, onStatus }) {
  const [id, setId] = useState("");
  const [text, setText] = useState("");

  async function createCard() {
    await api("/api/editor/cards", {
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
    });
    setId("");
    setText("");
    onStatus("Card created");
    await onRefresh();
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
                <button type="button" onClick={() => onOpen("content")}>{warning.code}</button>
                <span>{warning.message}</span>
              </li>
            ))}
            {diagnostics.warnings?.length === 0 && <li className="warning">No diagnostics warnings.</li>}
          </ul>
        </>
      ) : (
        <div className="empty-state">No review has been run in this session.</div>
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
      <div className="subsection subsection--plain">
        <h3>Fallback</h3>
        <a className="fallback-link" href="/classic">Open classic dashboard</a>
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

function createAssetMap(assets) {
  const map = new Map();
  for (const asset of assets) {
    if (asset?.cardId) map.set(asset.cardId, asset);
  }
  return map;
}

createRoot(document.getElementById("root")).render(<App />);
