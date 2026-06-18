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
    inventory: Array.isArray(options.inventory) ? [...options.inventory] : [],
    tags: { ...(options.tags ?? {}) },
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
      const eligible = getEligibleCards(cards, state);

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
      runInventoryHook("on_tick", state, { card, choice });
      state.gameOver = evaluateGameOver(state.factions);

      return {
        state,
        gameOver: state.gameOver,
        nextCard: state.gameOver ? null : runtime.draw()
      };
    },

    acquire(item) {
      assertPlayable(state);
      acquireItem(state, item);
      return state;
    },

    dismissItem(itemId) {
      assertPlayable(state);
      dismissItem(state, itemId);
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

    return requirementsMatch(card.requirements, state.tags);
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

  if (effects.factions) {
    for (const [faction, delta] of Object.entries(effects.factions)) {
      assertFaction(faction);
      const scale = state.factionScales[faction] ?? 1;
      state.factions[faction] = clampFaction(state.factions[faction] + delta * scale);
    }
  }

  for (const item of effects.acquire ?? []) {
    acquireItem(state, item);
  }

  for (const itemId of effects.dismissItems ?? []) {
    dismissItem(state, itemId);
  }
}

function acquireItem(state, item) {
  if (!item?.id) {
    throw new CoreError("Inventory entries require an id");
  }

  if (state.inventory.some((candidate) => candidate.id === item.id)) {
    return;
  }

  state.inventory.push(item);
  applyInventoryTags(state, item);
  runItemHook(item, "on_acquire", state);
}

function dismissItem(state, itemId) {
  const index = state.inventory.findIndex((item) => item.id === itemId);
  if (index === -1) {
    return;
  }

  const [item] = state.inventory.splice(index, 1);
  runItemHook(item, "on_dismiss", state);
  removeInventoryTags(state, item);
}

function applyInventoryTags(state, item) {
  for (const tag of item.tags ?? []) {
    state.tags[tag] = true;
  }

  if (item.kind) {
    state.tags[`kind:${item.kind}`] = true;
  }
}

function removeInventoryTags(state, item) {
  for (const tag of item.tags ?? []) {
    delete state.tags[tag];
  }
}

function runInventoryHook(name, state, event) {
  for (const item of [...state.inventory]) {
    runItemHook(item, name, state, event);
  }
}

function runItemHook(item, name, state, event = {}) {
  const hook = item.hooks?.[name];
  if (!hook) {
    return;
  }

  if (typeof hook !== "function") {
    throw new CoreError(`Hook '${name}' on item '${item.id}' must be a function`);
  }

  hook(createHookContext(state, item, event));
}

function createHookContext(state, item, event) {
  return {
    state,
    item,
    event,
    setTag(tag, value = true) {
      state.tags[tag] = value;
    },
    clearTag(tag) {
      delete state.tags[tag];
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

function requirementsMatch(requirements = {}, tags) {
  return (
    allMatch(requirements.allTags, tags) &&
    anyMatch(requirements.anyTags, tags) &&
    noneMatch(requirements.noneTags, tags)
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

