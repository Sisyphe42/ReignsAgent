/**
 * ReignsAgent deployable player runtime (source form).
 *
 * This is the source template. scripts/build-game.mjs rewrites the CORE_IMPORT
 * marker below to inline the headless core at build time, so the shipped
 * player-runtime.js is fully self-contained and imports nothing from the repo.
 *
 * The visible game is pure card text plus binary left/right swipes. No pipeline,
 * reviewer, AI connector, or creator dashboard logic is ever shipped to players.
 */

/* CORE_IMPORT_MARKER */

export function createPlayer(build, options = {}) {
  if (!build || typeof build !== "object") {
    throw new Error("createPlayer requires a game build");
  }

  const cards = build.content?.cards ?? build.cards;
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error("Game build has no cards");
  }

  const rng = options.rng ?? Math.random;
  const i18n = build.player?.i18n ?? build.content?.metadata?.i18n ?? {};
  let locale = resolvePlayerLocale(options.locale, i18n);
  const runtime = createCoreRuntime({ cards, rng });
  const listeners = new Set();

  const player = {
    get turn() {
      return runtime.state.turn;
    },

    get factions() {
      return { ...runtime.state.factions };
    },

    get currentCard() {
      const card = runtime.cards.find((candidate) => candidate.id === runtime.state.currentCardId) ?? null;
      return card ? localizePlayerCard(cloneCard(card), locale, i18n) : null;
    },

    get gameOver() {
      return runtime.state.gameOver ? { ...runtime.state.gameOver } : null;
    },

    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setLocale(nextLocale) {
      locale = resolvePlayerLocale(nextLocale, i18n);
      this.emit();
      return locale;
    },

    start() {
      if (!runtime.state.currentCardId && !runtime.state.gameOver) {
        runtime.draw();
      }
      this.emit();
      return this.snapshot();
    },

    swipe(direction) {
      if (direction !== "left" && direction !== "right") {
        throw new Error("swipe direction must be 'left' or 'right'");
      }
      if (runtime.state.gameOver) {
        throw new Error("The reign has ended");
      }
      if (!runtime.state.currentCardId) {
        runtime.draw();
      }
      if (!runtime.state.currentCardId) {
        this.emit();
        return this.snapshot();
      }
      const card = this.currentCard;
      const hasChoice = card?.choices?.some((choice) => choice.id === direction);
      if (!hasChoice) {
        throw new Error(`Current card '${card?.id}' has no '${direction}' choice`);
      }
      runtime.choose(direction);
      this.emit();
      return this.snapshot();
    },

    snapshot() {
      return {
        turn: this.turn,
        factions: this.factions,
        currentCard: this.currentCard,
        gameOver: this.gameOver
      };
    },

    emit() {
      const snapshot = this.snapshot();
      for (const listener of listeners) {
        listener(snapshot);
      }
    }
  };

  return player;
}

function cloneCard(card) {
  return {
    ...card,
    choices: card.choices.map((choice) => ({ ...choice, effects: { ...(choice.effects ?? {}) } })),
    requirements: { ...(card.requirements ?? {}) }
  };
}

function resolvePlayerLocale(requestedLocale, i18n = {}) {
  const defaultLocale = typeof i18n.defaultLocale === "string" && i18n.defaultLocale.length > 0 ? i18n.defaultLocale : "en";
  const supportedLocales = Array.isArray(i18n.supportedLocales) ? i18n.supportedLocales : [];

  if (typeof requestedLocale !== "string" || requestedLocale.length === 0) {
    return defaultLocale;
  }

  if (supportedLocales.length === 0 || supportedLocales.includes(requestedLocale)) {
    return requestedLocale;
  }

  const language = requestedLocale.split("-")[0];
  return supportedLocales.find((locale) => locale.split("-")[0] === language) ?? defaultLocale;
}

function localizePlayerCard(card, locale, i18n) {
  const defaultLocale = resolvePlayerLocale(null, i18n);
  const localizedCard = pickLocaleEntry(card.i18n, locale, defaultLocale);
  return {
    ...card,
    locale,
    text: localizedCard?.text ?? card.text,
    choices: card.choices.map((choice) => {
      const cardChoice = localizedCard?.choices?.[choice.id] ?? {};
      const choiceEntry = pickLocaleEntry(choice.i18n, locale, defaultLocale);
      return {
        ...choice,
        label: choiceEntry?.label ?? cardChoice.label ?? choice.label
      };
    })
  };
}

function pickLocaleEntry(entries, locale, defaultLocale) {
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return null;
  }

  return entries[locale] ?? entries[locale?.split("-")[0]] ?? entries[defaultLocale] ?? null;
}

export const PLAYER_RUNTIME_VERSION = 1;
