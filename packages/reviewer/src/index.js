import { FACTIONS, createRuntime, getEligibleCards } from "../../core/src/index.js";

const DEFAULT_CYCLES = 100000;
const DEFAULT_MAX_TURNS = 100;

export function runMonteCarloReview(options = {}) {
  const cards = options.cards ?? [];
  const cycles = normalizePositiveInteger(options.cycles ?? DEFAULT_CYCLES, "cycles");
  const maxTurns = normalizePositiveInteger(options.maxTurns ?? DEFAULT_MAX_TURNS, "maxTurns");
  const baseSeed = normalizeSeed(options.seed ?? 1);
  const choose = options.choose ?? chooseRandomChoice;
  const initialState = options.initialState ?? {};

  if (typeof choose !== "function") {
    throw new TypeError("choose must be a function");
  }

  const aggregate = createAggregate(cards);

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const rng = createSeededRng(baseSeed + cycle);
    const runtime = createRuntime({ cards, state: cloneInitialState(initialState), rng });
    const result = runCycle(runtime, { maxTurns, choose, rng });
    recordCycle(aggregate, result);
  }

  return buildReport({
    aggregate,
    cards,
    cycles,
    maxTurns,
    seed: baseSeed,
    graph: analyzeCardGraph(cards, initialState.tags ?? {})
  });
}

export function analyzeCardGraph(cards, initialTags = {}) {
  const nodes = cards.map((card) => ({
    id: card.id,
    requirements: card.requirements ?? {}
  }));
  const producedTagsByCard = new Map();

  for (const card of cards) {
    producedTagsByCard.set(card.id, collectProducedTags(card));
  }

  const edges = [];
  for (const [sourceId, producedTags] of producedTagsByCard.entries()) {
    for (const target of cards) {
      const requiredTags = [
        ...(target.requirements?.allTags ?? []),
        ...(target.requirements?.anyTags ?? [])
      ];
      const enablingTags = requiredTags.filter((tag) => producedTags.has(tag));

      if (enablingTags.length > 0 && sourceId !== target.id) {
        edges.push({ from: sourceId, to: target.id, tags: enablingTags });
      }
    }
  }

  const producedTags = new Set(initialTrueTags(initialTags));
  for (const tags of producedTagsByCard.values()) {
    for (const tag of tags) {
      producedTags.add(tag);
    }
  }

  return {
    nodes,
    edges,
    isolatedCards: nodes
      .filter((node) => !edges.some((edge) => edge.from === node.id || edge.to === node.id))
      .map((node) => node.id),
    unsatisfiedRequiredTags: collectUnsatisfiedRequiredTags(cards, producedTags)
  };
}

function runCycle(runtime, options) {
  const visits = new Map();
  const choices = new Map();
  let currentCard = runtime.draw();
  let stalled = currentCard === null;

  while (!runtime.state.gameOver && currentCard && runtime.state.turn < options.maxTurns) {
    increment(visits, currentCard.id);
    const selectedChoice = options.choose({
      card: currentCard,
      state: runtime.state,
      rng: options.rng
    });

    if (!selectedChoice?.id) {
      throw new TypeError("choose must return a choice with an id");
    }

    increment(choices, `${currentCard.id}:${selectedChoice.id}`);
    const step = runtime.choose(selectedChoice.id);
    currentCard = step.nextCard;
    stalled = !runtime.state.gameOver && currentCard === null;
  }

  return {
    turns: runtime.state.turn,
    gameOver: runtime.state.gameOver,
    stalled,
    factions: { ...runtime.state.factions },
    visits,
    choices
  };
}

function chooseRandomChoice({ card, rng }) {
  const index = Math.floor(rng() * card.choices.length);
  return card.choices[Math.min(index, card.choices.length - 1)];
}

function createAggregate(cards) {
  return {
    cycles: 0,
    totalTurns: 0,
    stalledCycles: 0,
    gameOverCycles: 0,
    gameOverByFaction: Object.fromEntries(FACTIONS.map((faction) => [faction, 0])),
    factionTotals: Object.fromEntries(FACTIONS.map((faction) => [faction, 0])),
    cardVisits: Object.fromEntries(cards.map((card) => [card.id, 0])),
    choiceVisits: {}
  };
}

function recordCycle(aggregate, result) {
  aggregate.cycles += 1;
  aggregate.totalTurns += result.turns;

  if (result.stalled) {
    aggregate.stalledCycles += 1;
  }

  if (result.gameOver) {
    aggregate.gameOverCycles += 1;
    aggregate.gameOverByFaction[result.gameOver.faction] += 1;
  }

  for (const faction of FACTIONS) {
    aggregate.factionTotals[faction] += result.factions[faction];
  }

  for (const [cardId, count] of result.visits.entries()) {
    aggregate.cardVisits[cardId] = (aggregate.cardVisits[cardId] ?? 0) + count;
  }

  for (const [choiceId, count] of result.choices.entries()) {
    aggregate.choiceVisits[choiceId] = (aggregate.choiceVisits[choiceId] ?? 0) + count;
  }
}

function buildReport({ aggregate, cards, cycles, maxTurns, seed, graph }) {
  const averageTurns = aggregate.totalTurns / cycles;
  const factionAverages = Object.fromEntries(
    FACTIONS.map((faction) => [faction, round(aggregate.factionTotals[faction] / cycles)])
  );
  const cardVisitRates = Object.fromEntries(
    Object.entries(aggregate.cardVisits).map(([cardId, count]) => [cardId, round(count / cycles)])
  );
  const warnings = buildWarnings({ aggregate, cards, graph });

  return {
    schemaVersion: 1,
    module: "ReignsAgent-Reviewer",
    parameters: { cycles, maxTurns, seed },
    summary: {
      averageTurns: round(averageTurns),
      gameOverRate: round(aggregate.gameOverCycles / cycles),
      stalledRate: round(aggregate.stalledCycles / cycles),
      gameOverByFaction: aggregate.gameOverByFaction,
      factionAverages
    },
    coverage: {
      cardVisitRates,
      choiceVisits: aggregate.choiceVisits
    },
    graph,
    diagnostics: {
      warnings
    }
  };
}

function buildWarnings({ aggregate, cards, graph }) {
  const warnings = [];
  const neverVisited = cards
    .map((card) => card.id)
    .filter((cardId) => (aggregate.cardVisits[cardId] ?? 0) === 0);

  if (neverVisited.length > 0) {
    warnings.push({
      code: "never_visited_cards",
      message: "Some cards were never reached during simulation.",
      cardIds: neverVisited
    });
  }

  if (aggregate.stalledCycles > 0) {
    warnings.push({
      code: "stalled_cycles",
      message: "Some cycles ended because no eligible card was available.",
      cycles: aggregate.stalledCycles
    });
  }

  if (graph.unsatisfiedRequiredTags.length > 0) {
    warnings.push({
      code: "unsatisfied_required_tags",
      message: "Some card requirements cannot be satisfied by initial tags or card effects.",
      tags: graph.unsatisfiedRequiredTags
    });
  }

  return warnings;
}

function collectProducedTags(card) {
  const tags = new Set();

  for (const choice of card.choices ?? []) {
    for (const [tag, value] of Object.entries(choice.effects?.tags ?? {})) {
      if (value !== false && value !== null && value !== undefined) {
        tags.add(tag);
      }
    }

    for (const item of choice.effects?.acquire ?? []) {
      for (const tag of item.tags ?? []) {
        tags.add(tag);
      }

      if (item.kind) {
        tags.add(`kind:${item.kind}`);
      }
    }
  }

  return tags;
}

function collectUnsatisfiedRequiredTags(cards, producedTags) {
  const missing = new Set();

  for (const card of cards) {
    for (const tag of card.requirements?.allTags ?? []) {
      if (!producedTags.has(tag)) {
        missing.add(tag);
      }
    }

    const anyTags = card.requirements?.anyTags ?? [];
    if (anyTags.length > 0 && !anyTags.some((tag) => producedTags.has(tag))) {
      for (const tag of anyTags) {
        missing.add(tag);
      }
    }
  }

  return [...missing].sort();
}

function initialTrueTags(tags) {
  return Object.entries(tags)
    .filter(([, value]) => Boolean(value))
    .map(([tag]) => tag);
}

function cloneInitialState(initialState) {
  return {
    ...initialState,
    factions: initialState.factions ? { ...initialState.factions } : undefined,
    inventory: initialState.inventory ? [...initialState.inventory] : undefined,
    tags: initialState.tags ? { ...initialState.tags } : undefined,
    cardWeights: initialState.cardWeights ? { ...initialState.cardWeights } : undefined,
    factionScales: initialState.factionScales ? { ...initialState.factionScales } : undefined,
    dismissedCards: initialState.dismissedCards ? [...initialState.dismissedCards] : undefined
  };
}

function createSeededRng(seed) {
  let state = seed >>> 0;

  return function rng() {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }

  return value;
}

function normalizeSeed(value) {
  if (!Number.isInteger(value)) {
    throw new TypeError("seed must be an integer");
  }

  return value;
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

