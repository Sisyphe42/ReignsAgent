export const FACTIONS = Object.freeze(["faith", "people", "military", "treasury"]);

const DEFAULT_FACTION_VALUE = 50;
const SNAPSHOT_SCHEMA_VERSION = 1;
const REQUIREMENT_KEYS = new Set(["allTags", "anyTags", "noneTags", "variables", "factions"]);
const EFFECT_KEYS = new Set(["tags", "variables", "factions", "activateHooks", "dismissHooks"]);
const HOOK_NAMES = new Set(["on_acquire", "on_tick", "on_dismiss"]);

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
    variables: cloneJsonSafe(options.variables ?? {}, "Initial variables"),
    tags: cloneJsonSafe(options.tags ?? {}, "Initial tags"),
    activeHooks: normalizeActiveHooks(options.activeHooks ?? [], "Initial state"),
    cardWeights: cloneJsonSafe(options.cardWeights ?? {}, "Initial card weights"),
    factionScales: normalizeFactionScales(options.factionScales),
    dismissedCards: new Set(options.dismissedCards ?? options.dismissedCardIds ?? []),
    currentCardId: options.currentCardId ?? null,
    gameOver: evaluateGameOver(factions)
  };
}

export function createRuntime(options = {}) {
  const cards = normalizeCards(options.cards ?? []);
  const state = createInitialState(options.state ?? options.initialState ?? {});
  const rng = options.rng ?? Math.random;
  const events = [];

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

    get events() {
      return events.map((event) => Object.freeze(cloneJsonSafe(event, "Runtime event")));
    },

    snapshot() {
      return serializeState(state);
    },

    draw() {
      assertPlayable(state);
      let eligible = getEligibleCards(cards, state);

      if (eligible.length === 0 && state.dismissedCards.size > 0) {
        state.dismissedCards.clear();
        recordEvent("loop_reset");
        eligible = getEligibleCards(cards, state);
      }

      if (eligible.length === 0) {
        state.currentCardId = null;
        recordEvent("stall");
        return null;
      }

      const selected = chooseWeightedCard(eligible, state, rng);
      state.currentCardId = selected.id;
      recordEvent("draw", { cardId: selected.id });
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

      applyChoice(choice, state, recordEvent);
      state.dismissedCards.add(card.id);
      state.currentCardId = null;
      state.turn += 1;
      const choiceEvent = recordEvent("choice", { cardId: card.id, choiceId: choice.id });
      runActiveHooks("on_tick", state, { card, choice });
      state.gameOver = evaluateGameOver(state.factions);

      if (state.gameOver) {
        recordEvent("game_over", state.gameOver);
      }

      return {
        event: choiceEvent,
        state,
        gameOver: state.gameOver,
        nextCard: state.gameOver ? null : runtime.draw()
      };
    },

    step(choiceId) {
      assertPlayable(state);

      if (!state.currentCardId) {
        const drawn = runtime.draw();

        if (!choiceId || !drawn) {
          return {
            event: lastEvent(),
            state,
            gameOver: state.gameOver,
            nextCard: drawn
          };
        }
      }

      if (!choiceId) {
        return {
          event: null,
          state,
          gameOver: state.gameOver,
          nextCard: getCurrentCard(cards, state)
        };
      }

      return runtime.choose(choiceId);
    },

    activateHook(hookEntry) {
      assertPlayable(state);
      activateHookEntry(state, hookEntry, recordEvent);
      return state;
    },

    dismissHook(hookId) {
      assertPlayable(state);
      dismissHookEntry(state, hookId, recordEvent);
      return state;
    }
  };

  function recordEvent(type, payload = {}) {
    const event = {
      type,
      turn: state.turn,
      ...cloneJsonSafe(payload, `Event '${type}' payload`)
    };
    events.push(event);
    return cloneJsonSafe(event, `Event '${type}'`);
  }

  function lastEvent() {
    return events.length > 0 ? cloneJsonSafe(events.at(-1), "Runtime event") : null;
  }

  return runtime;
}

export function serializeState(state) {
  assertPlainRecord(state, "Runtime state");

  return cloneJsonSafe(
    {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      turn: state.turn ?? 0,
      factions: state.factions ?? {},
      variables: state.variables ?? {},
      tags: state.tags ?? {},
      cardWeights: state.cardWeights ?? {},
      factionScales: state.factionScales ?? {},
      dismissedCardIds: dismissedCardIdsFromState(state),
      currentCardId: state.currentCardId ?? null,
      gameOver: state.gameOver ?? null,
      activeHooks: (state.activeHooks ?? []).map(serializeHookEntry)
    },
    "Runtime snapshot"
  );
}

export function restoreState(snapshot, options = {}) {
  assertPlainRecord(snapshot, "Runtime snapshot");

  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new CoreError(`Unsupported snapshot schemaVersion '${snapshot.schemaVersion}'`);
  }

  const activeHooks = restoreHookEntries(snapshot.activeHooks ?? [], options);

  return createInitialState({
    turn: snapshot.turn ?? 0,
    factions: snapshot.factions,
    variables: snapshot.variables ?? {},
    tags: snapshot.tags ?? {},
    activeHooks,
    cardWeights: snapshot.cardWeights ?? {},
    factionScales: snapshot.factionScales ?? {},
    dismissedCardIds: snapshot.dismissedCardIds ?? [],
    currentCardId: snapshot.currentCardId ?? null
  });
}

export function getEligibleCards(cards, state) {
  return cards.filter((card) => {
    if (state.dismissedCards.has(card.id)) {
      return false;
    }

    return requirementsMatch(card.requirements, state);
  });
}

export function normalizeCards(cards) {
  if (!Array.isArray(cards)) {
    throw new CoreError("cards must be an array");
  }

  const seenCardIds = new Set();

  return cards.map((card) => {
    if (!card?.id) {
      throw new CoreError("Each card requires an id");
    }

    if (seenCardIds.has(card.id)) {
      throw new CoreError(`Duplicate card id '${card.id}'`);
    }
    seenCardIds.add(card.id);

    if (!Array.isArray(card.choices) || card.choices.length === 0) {
      throw new CoreError(`Card '${card.id}' requires at least one choice`);
    }

    const weight = card.weight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new CoreError(`Card '${card.id}' weight must be a positive finite number`);
    }

    const requirements = card.requirements === undefined ? {} : card.requirements;
    validateRequirements(card.id, requirements);
    const seenChoiceIds = new Set();

    return {
      ...card,
      weight,
      requirements,
      choices: card.choices.map((choice) => {
        if (!choice?.id) {
          throw new CoreError(`Card '${card.id}' has a choice without an id`);
        }

        if (seenChoiceIds.has(choice.id)) {
          throw new CoreError(`Card '${card.id}' has duplicate choice id '${choice.id}'`);
        }
        seenChoiceIds.add(choice.id);
        const effects = choice.effects === undefined ? {} : choice.effects;
        validateEffects(card.id, choice.id, effects);

        return {
          ...choice,
          effects
        };
      })
    };
  });
}

export function validateCards(cards) {
  try {
    normalizeCards(cards);
    return { valid: true, errors: [] };
  } catch (error) {
    return { valid: false, errors: [error.message] };
  }
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

function normalizeActiveHooks(activeHooks, context) {
  if (!Array.isArray(activeHooks)) {
    throw new CoreError(`${context} activeHooks must be an array`);
  }

  return activeHooks.map((hookEntry) => normalizeHookEntry(hookEntry, context));
}

function normalizeHookEntry(hookEntry, context) {
  validateHookEntry(hookEntry, context);

  const normalized = {
    id: hookEntry.id,
    tags: [...(hookEntry.tags ?? [])],
    data: cloneJsonSafe(hookEntry.data ?? {}, `${context} hook entry '${hookEntry.id}' data`)
  };

  if (hookEntry.hooks !== undefined) {
    normalized.hooks = hookEntry.hooks;
  }

  return normalized;
}

function validateRequirements(cardId, requirements) {
  assertPlainRecord(requirements, `Card '${cardId}' requirements`);

  for (const key of Object.keys(requirements)) {
    if (!REQUIREMENT_KEYS.has(key)) {
      throw new CoreError(`Card '${cardId}' has unknown requirement '${key}'`);
    }
  }

  assertStringArray(requirements.allTags ?? [], `Card '${cardId}' allTags`);
  assertStringArray(requirements.anyTags ?? [], `Card '${cardId}' anyTags`);
  assertStringArray(requirements.noneTags ?? [], `Card '${cardId}' noneTags`);

  if (requirements.variables !== undefined) {
    assertPlainRecord(requirements.variables, `Card '${cardId}' variables requirement`);
  }

  validateFactionRequirements(cardId, requirements.factions);
}

function validateEffects(cardId, choiceId, effects) {
  assertPlainRecord(effects, `Choice '${choiceId}' on card '${cardId}' effects`);

  for (const key of Object.keys(effects)) {
    if (!EFFECT_KEYS.has(key)) {
      throw new CoreError(`Choice '${choiceId}' on card '${cardId}' has unknown effect '${key}'`);
    }
  }

  if (effects.tags !== undefined) {
    assertPlainRecord(effects.tags, `Choice '${choiceId}' on card '${cardId}' tag effects`);
  }

  if (effects.variables !== undefined) {
    assertPlainRecord(effects.variables, `Choice '${choiceId}' on card '${cardId}' variable effects`);
  }

  if (effects.factions !== undefined) {
    assertPlainRecord(effects.factions, `Choice '${choiceId}' on card '${cardId}' faction effects`);
    for (const [faction, delta] of Object.entries(effects.factions)) {
      assertFaction(faction);
      if (!Number.isFinite(delta)) {
        throw new CoreError(`Choice '${choiceId}' on card '${cardId}' faction delta '${faction}' must be finite`);
      }
    }
  }

  if (effects.activateHooks !== undefined) {
    if (!Array.isArray(effects.activateHooks)) {
      throw new CoreError(`Choice '${choiceId}' on card '${cardId}' activateHooks must be an array`);
    }
    for (const hookEntry of effects.activateHooks) {
      validateHookEntry(hookEntry, `Choice '${choiceId}' on card '${cardId}'`);
    }
  }

  if (effects.dismissHooks !== undefined) {
    assertStringArray(effects.dismissHooks, `Choice '${choiceId}' on card '${cardId}' dismissHooks`);
  }
}

function validateHookEntry(hookEntry, context) {
  assertPlainRecord(hookEntry, `${context} hook entry`);

  if (!hookEntry.id) {
    throw new CoreError(`${context} hook entry requires an id`);
  }

  assertStringArray(hookEntry.tags ?? [], `${context} hook entry '${hookEntry.id}' tags`);

  if (hookEntry.data !== undefined) {
    cloneJsonSafe(hookEntry.data, `${context} hook entry '${hookEntry.id}' data`);
  }

  if (hookEntry.hooks !== undefined) {
    assertPlainRecord(hookEntry.hooks, `${context} hook entry '${hookEntry.id}' hooks`);

    for (const [hookName, hook] of Object.entries(hookEntry.hooks)) {
      if (!HOOK_NAMES.has(hookName)) {
        throw new CoreError(`${context} hook entry '${hookEntry.id}' has unknown hook '${hookName}'`);
      }

      if (typeof hook !== "function") {
        throw new CoreError(`${context} hook entry '${hookEntry.id}' hook '${hookName}' must be a function`);
      }
    }
  }
}

function applyChoice(choice, state, recordEvent) {
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
    activateHookEntry(state, hookEntry, recordEvent);
  }

  for (const hookId of effects.dismissHooks ?? []) {
    dismissHookEntry(state, hookId, recordEvent);
  }
}

function activateHookEntry(state, hookEntry, recordEvent = null) {
  const normalizedHookEntry = normalizeHookEntry(hookEntry, "Runtime");

  if (state.activeHooks.some((candidate) => candidate.id === normalizedHookEntry.id)) {
    return;
  }

  state.activeHooks.push(normalizedHookEntry);
  applyHookTags(state, normalizedHookEntry);
  recordEvent?.("hook_activate", hookEventPayload(normalizedHookEntry));
  runHookEntry(normalizedHookEntry, "on_acquire", state);
}

function dismissHookEntry(state, hookId, recordEvent = null) {
  const index = state.activeHooks.findIndex((hookEntry) => hookEntry.id === hookId);
  if (index === -1) {
    return;
  }

  const [hookEntry] = state.activeHooks.splice(index, 1);
  runHookEntry(hookEntry, "on_dismiss", state);
  removeHookTags(state, hookEntry);
  recordEvent?.("hook_dismiss", hookEventPayload(hookEntry));
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

  hook(createHookContext(state, hookEntry, event));
}

function createHookContext(state, hookEntry, event) {
  return {
    state,
    hookEntry,
    data: hookEntry.data,
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
    variablesMatch(requirements.variables, state.variables) &&
    factionsMatch(requirements.factions, state.factions)
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

function factionsMatch(required = {}, factions) {
  return Object.entries(required).every(([faction, rule]) => factionRuleMatches(factions[faction], rule));
}

function factionRuleMatches(value, rule) {
  if (Number.isFinite(rule)) {
    return value === rule;
  }

  if (rule.equals !== undefined && value !== rule.equals) {
    return false;
  }
  if (rule.min !== undefined && value < rule.min) {
    return false;
  }
  if (rule.max !== undefined && value > rule.max) {
    return false;
  }
  return true;
}

function validateFactionRequirements(cardId, requirements) {
  if (requirements === undefined) {
    return;
  }

  assertPlainRecord(requirements, `Card '${cardId}' faction requirements`);

  for (const [faction, rule] of Object.entries(requirements)) {
    assertFaction(faction);
    validateFactionRequirementRule(`Card '${cardId}' faction requirement '${faction}'`, rule);
  }
}

function validateFactionRequirementRule(context, rule) {
  if (Number.isFinite(rule)) {
    validateFactionThreshold(context, rule);
    return;
  }

  assertPlainRecord(rule, context);
  const allowedKeys = new Set(["min", "max", "equals"]);
  const keys = Object.keys(rule);
  if (keys.length === 0) {
    throw new CoreError(`${context} must include min, max, or equals`);
  }

  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      throw new CoreError(`${context} has unknown key '${key}'`);
    }
    validateFactionThreshold(`${context}.${key}`, rule[key]);
  }

  if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
    throw new CoreError(`${context}.min must be less than or equal to max`);
  }
}

function validateFactionThreshold(context, value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new CoreError(`${context} must be a finite number between 0 and 100`);
  }
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

function serializeHookEntry(hookEntry) {
  validateHookEntry(hookEntry, "Runtime snapshot");

  return {
    id: hookEntry.id,
    tags: [...(hookEntry.tags ?? [])],
    data: cloneJsonSafe(hookEntry.data ?? {}, `Runtime snapshot hook '${hookEntry.id}' data`),
    requiresRegistry: hasHooks(hookEntry)
  };
}

function restoreHookEntries(activeHooks, options) {
  if (!Array.isArray(activeHooks)) {
    throw new CoreError("Runtime snapshot activeHooks must be an array");
  }

  return activeHooks.map((hookSnapshot) => restoreHookEntry(hookSnapshot, options));
}

function restoreHookEntry(hookSnapshot, options) {
  assertPlainRecord(hookSnapshot, "Runtime snapshot hook");

  if (!hookSnapshot.id) {
    throw new CoreError("Runtime snapshot hook requires an id");
  }

  assertStringArray(hookSnapshot.tags ?? [], `Runtime snapshot hook '${hookSnapshot.id}' tags`);

  const registryValue = options.hookRegistry?.[hookSnapshot.id];
  const registryHooks = registryValue?.hooks ?? registryValue;
  const restored = {
    id: hookSnapshot.id,
    tags: [...(hookSnapshot.tags ?? [])],
    data: cloneJsonSafe(hookSnapshot.data ?? {}, `Runtime snapshot hook '${hookSnapshot.id}' data`)
  };

  if (registryHooks) {
    restored.hooks = registryHooks;
  } else if (hookSnapshot.requiresRegistry && !options.allowMissingHooks) {
    throw new CoreError(`Missing hook registry entry for '${hookSnapshot.id}'`);
  }

  return normalizeHookEntry(restored, "Runtime snapshot");
}

function hookEventPayload(hookEntry) {
  return {
    hookId: hookEntry.id,
    tags: [...(hookEntry.tags ?? [])],
    data: cloneJsonSafe(hookEntry.data ?? {}, `Hook '${hookEntry.id}' event data`)
  };
}

function hasHooks(hookEntry) {
  return Object.keys(hookEntry.hooks ?? {}).length > 0;
}

function dismissedCardIdsFromState(state) {
  if (state.dismissedCards instanceof Set) {
    return [...state.dismissedCards];
  }

  if (Array.isArray(state.dismissedCards)) {
    return [...state.dismissedCards];
  }

  return [];
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

function assertPlainRecord(value, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CoreError(`${context} must be an object`);
  }
}

function assertStringArray(value, context) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new CoreError(`${context} must be an array of non-empty strings`);
  }
}

function cloneJsonSafe(value, context) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CoreError(`${context} must contain only finite numbers`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneJsonSafe(entry, `${context}[${index}]`));
  }

  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const clone = {};

    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) {
        throw new CoreError(`${context}.${key} must not be undefined`);
      }
      clone[key] = cloneJsonSafe(entry, `${context}.${key}`);
    }

    return clone;
  }

  throw new CoreError(`${context} must be JSON-safe`);
}

function clampFaction(value) {
  if (!Number.isFinite(value)) {
    throw new CoreError("Faction values must be finite numbers");
  }

  return Math.max(0, Math.min(100, value));
}
