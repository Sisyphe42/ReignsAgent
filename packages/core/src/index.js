export const FACTIONS = Object.freeze(["faith", "people", "military", "treasury"]);

const DEFAULT_FACTION_VALUE = 50;

export class CoreError extends Error {
  constructor(message) {
    super(message);
    this.name = "CoreError";
  }
}

export function createInitialState(options = {}) {
  const factions = normalizeFactions(options.factions);

  return {
    turn: options.turn ?? 0,
    factions,
    variables: { ...(options.variables ?? {}) },
    tags: { ...(options.tags ?? {}) },
    activeHooks: Array.isArray(options.activeHooks) ? [...options.activeHooks] : [],
    cardWeights: { ...(options.cardWeights ?? {}) },
    factionScales: normalizeFactionScales(options.factionScales),
    dismissedCards: new Set(options.dismissedCards ?? []),
    currentCardId: options.currentCardId ?? null,
    gameOver: evaluateGameOver(factions)
  };
}

export function createRuntime(options = {}) {
  const cards = normalizeCards(options.cards ?? []);
  const state = createInitialState(options.state ?? options.initialState ?? {});
  const rng = options.rng ?? Math.random;

  if (typeof rng !== "function") {
    throw new CoreError("rng must be a function");
  }

  const runtime = {
    get state() {
      return state;
    },

    get cards() {
      return cards;
    },

    draw() {
      assertPlayable(state);
      let eligible = getEligibleCards(cards, state);

      if (eligible.length === 0 && state.dismissedCards.size > 0) {
        state.dismissedCards.clear();
        eligible = getEligibleCards(cards, state);
      }

      if (eligible.length === 0) {
        state.currentCardId = null;
        return null;
      }

      const selected = chooseWeightedCard(eligible, state, rng);
      state.currentCardId = selected.id;
      return selected;
    },

    choose(choiceId) {
      assertPlayable(state);
      const card = getCurrentCard(cards, state);

      if (!card) {
        throw new CoreError("No current card is selected");
      }

      const choice = card.choices.find((candidate) => candidate.id === choiceId);
      if (!choice) {
        throw new CoreError(`Unknown choice '${choiceId}' for card '${card.id}'`);
      }

      applyChoice(choice, state);
      state.dismissedCards.add(card.id);
      state.currentCardId = null;
      state.turn += 1;
      runActiveHooks("on_tick", state, { card, choice });
      state.gameOver = evaluateGameOver(state.factions);

      return {
        state,
        gameOver: state.gameOver,
        nextCard: state.gameOver ? null : runtime.draw()
      };
    },

    activateHook(hookEntry) {
      assertPlayable(state);
      activateHookEntry(state, hookEntry);
      return state;
    },

    dismissHook(hookId) {
      assertPlayable(state);
      dismissHookEntry(state, hookId);
      return state;
    }
  };

  return runtime;
}

export function getEligibleCards(cards, state) {
  return cards.filter((card) => {
    if (state.dismissedCards.has(card.id)) {
      return false;
    }

    return requirementsMatch(card.requirements, state);
  });
}

function normalizeCards(cards) {
  if (!Array.isArray(cards)) {
    throw new CoreError("cards must be an array");
  }

  return cards.map((card) => {
    if (!card?.id) {
      throw new CoreError("Each card requires an id");
    }

    if (!Array.isArray(card.choices) || card.choices.length === 0) {
      throw new CoreError(`Card '${card.id}' requires at least one choice`);
    }

    return {
      ...card,
      weight: card.weight ?? 1,
      requirements: card.requirements ?? {},
      choices: card.choices.map((choice) => {
        if (!choice?.id) {
          throw new CoreError(`Card '${card.id}' has a choice without an id`);
        }

        return {
          ...choice,
          effects: choice.effects ?? {}
        };
      })
    };
  });
}

function normalizeFactions(factions = {}) {
  const normalized = {};

  for (const faction of FACTIONS) {
    normalized[faction] = clampFaction(factions[faction] ?? DEFAULT_FACTION_VALUE);
  }

  return normalized;
}

function normalizeFactionScales(scales = {}) {
  const normalized = {};

  for (const faction of FACTIONS) {
    normalized[faction] = Number.isFinite(scales[faction]) ? scales[faction] : 1;
  }

  return normalized;
}

function applyChoice(choice, state) {
  const effects = choice.effects ?? {};

  if (effects.tags) {
    for (const [tag, value] of Object.entries(effects.tags)) {
      if (value === false || value === null || value === undefined) {
        delete state.tags[tag];
      } else {
        state.tags[tag] = value;
      }
    }
  }

  if (effects.variables) {
    for (const [variable, value] of Object.entries(effects.variables)) {
      if (value === null || value === undefined) {
        delete state.variables[variable];
      } else {
        state.variables[variable] = value;
      }
    }
  }

  if (effects.factions) {
    for (const [faction, delta] of Object.entries(effects.factions)) {
      assertFaction(faction);
      const scale = state.factionScales[faction] ?? 1;
      state.factions[faction] = clampFaction(state.factions[faction] + delta * scale);
    }
  }

  for (const hookEntry of effects.activateHooks ?? []) {
    activateHookEntry(state, hookEntry);
  }

  for (const hookId of effects.dismissHooks ?? []) {
    dismissHookEntry(state, hookId);
  }
}

function activateHookEntry(state, hookEntry) {
  if (!hookEntry?.id) {
    throw new CoreError("Hook entries require an id");
  }

  if (state.activeHooks.some((candidate) => candidate.id === hookEntry.id)) {
    return;
  }

  state.activeHooks.push(hookEntry);
  applyHookTags(state, hookEntry);
  runHookEntry(hookEntry, "on_acquire", state);
}

function dismissHookEntry(state, hookId) {
  const index = state.activeHooks.findIndex((hookEntry) => hookEntry.id === hookId);
  if (index === -1) {
    return;
  }

  const [hookEntry] = state.activeHooks.splice(index, 1);
  runHookEntry(hookEntry, "on_dismiss", state);
  removeHookTags(state, hookEntry);
}

function applyHookTags(state, hookEntry) {
  for (const tag of hookEntry.tags ?? []) {
    state.tags[tag] = true;
  }
}

function removeHookTags(state, hookEntry) {
  for (const tag of hookEntry.tags ?? []) {
    delete state.tags[tag];
  }
}

function runActiveHooks(name, state, event) {
  for (const hookEntry of [...state.activeHooks]) {
    runHookEntry(hookEntry, name, state, event);
  }
}

function runHookEntry(hookEntry, name, state, event = {}) {
  const hook = hookEntry.hooks?.[name];
  if (!hook) {
    return;
  }

  if (typeof hook !== "function") {
    throw new CoreError(`Hook '${name}' on '${hookEntry.id}' must be a function`);
  }

  hook(createHookContext(state, hookEntry, event));
}

function createHookContext(state, hookEntry, event) {
  return {
    state,
    hookEntry,
    event,
    setTag(tag, value = true) {
      state.tags[tag] = value;
    },
    clearTag(tag) {
      delete state.tags[tag];
    },
    setVariable(variable, value) {
      state.variables[variable] = value;
    },
    clearVariable(variable) {
      delete state.variables[variable];
    },
    adjustCardWeight(cardId, amount) {
      state.cardWeights[cardId] = (state.cardWeights[cardId] ?? 0) + amount;
    },
    scaleFaction(faction, factor) {
      assertFaction(faction);
      state.factionScales[faction] = (state.factionScales[faction] ?? 1) * factor;
    }
  };
}

function chooseWeightedCard(cards, state, rng) {
  const weighted = cards.map((card) => ({
    card,
    weight: Math.max(0, (card.weight ?? 1) + (state.cardWeights[card.id] ?? 0))
  }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);

  if (total <= 0) {
    return cards[0];
  }

  let cursor = rng() * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor < 0) {
      return entry.card;
    }
  }

  return weighted.at(-1).card;
}

function getCurrentCard(cards, state) {
  return cards.find((card) => card.id === state.currentCardId) ?? null;
}

function requirementsMatch(requirements = {}, state) {
  return (
    allMatch(requirements.allTags, state.tags) &&
    anyMatch(requirements.anyTags, state.tags) &&
    noneMatch(requirements.noneTags, state.tags) &&
    variablesMatch(requirements.variables, state.variables)
  );
}

function allMatch(required = [], tags) {
  return required.every((tag) => Boolean(tags[tag]));
}

function anyMatch(required = [], tags) {
  return required.length === 0 || required.some((tag) => Boolean(tags[tag]));
}

function noneMatch(blocked = [], tags) {
  return blocked.every((tag) => !tags[tag]);
}

function variablesMatch(required = {}, variables) {
  return Object.entries(required).every(([variable, value]) => variables[variable] === value);
}

function evaluateGameOver(factions) {
  const failedFaction = FACTIONS.find((faction) => factions[faction] <= 0 || factions[faction] >= 100);

  return failedFaction
    ? {
        reason: "faction_bounds",
        faction: failedFaction,
        value: factions[failedFaction]
      }
    : null;
}

function assertPlayable(state) {
  if (state.gameOver) {
    throw new CoreError("Game is over");
  }
}

function assertFaction(faction) {
  if (!FACTIONS.includes(faction)) {
    throw new CoreError(`Unknown faction '${faction}'`);
  }
}

function clampFaction(value) {
  if (!Number.isFinite(value)) {
    throw new CoreError("Faction values must be finite numbers");
  }

  return Math.max(0, Math.min(100, value));
}
