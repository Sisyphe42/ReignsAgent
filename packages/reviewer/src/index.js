import { FACTIONS, createRuntime } from "../../core/src/index.js";

const REPORT_SCHEMA_VERSION = 1;
const DEFAULT_CYCLES = 100000;
const DEFAULT_MAX_TURNS = 100;
const DEFAULT_SAMPLE_LIMIT = 3;
const DEFAULT_FACTION_VALUE = 50;
const DEFAULT_THRESHOLDS = Object.freeze({
  dominantGameOverRate: 0.45,
  highGameOverRate: 0.8,
  lowCardCycleRate: 0.05,
  stalledRate: 0
});

export class ReviewerError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReviewerError";
  }
}

export function runMonteCarloReview(options = {}) {
  const config = normalizeReviewOptions(options);
  const aggregate = createAggregate(config.cards);
  const samples = [];

  for (let cycle = 0; cycle < config.cycles; cycle += 1) {
    const result = runSimulationCycle({
      cards: config.cards,
      maxTurns: config.maxTurns,
      seed: config.seed + cycle,
      choose: config.choose,
      initialState: config.initialState,
      includeEvents: config.includeSampleEvents && samples.length < config.sampleLimit
    });

    recordCycle(aggregate, result);

    if (samples.length < config.sampleLimit) {
      samples.push(createCycleSample(result));
    }
  }

  return buildReport({
    aggregate,
    cards: config.cards,
    cycles: config.cycles,
    maxTurns: config.maxTurns,
    seed: config.seed,
    thresholds: config.thresholds,
    sampleLimit: config.sampleLimit,
    includeSampleEvents: config.includeSampleEvents,
    samples,
    graph: analyzeCardGraph(config.cards, {
      tags: config.initialState.tags ?? {},
      variables: config.initialState.variables ?? {},
      factions: config.initialState.factions ?? {}
    })
  });
}

export function runSimulationCycle(options = {}) {
  const cards = options.cards ?? [];
  const maxTurns = normalizePositiveInteger(options.maxTurns ?? DEFAULT_MAX_TURNS, "maxTurns");
  const seed = normalizeSeed(options.seed ?? 1);
  const rng = options.rng ?? createSeededRng(seed);
  const choose = options.choose ?? chooseRandomChoice;

  if (typeof rng !== "function") {
    throw new ReviewerError("rng must be a function");
  }

  if (typeof choose !== "function") {
    throw new ReviewerError("choose must be a function");
  }

  const runtime = createRuntime({
    cards,
    state: cloneInitialState(options.initialState ?? {}),
    rng
  });

  return runCycle(runtime, {
    maxTurns,
    choose,
    rng,
    seed,
    includeEvents: Boolean(options.includeEvents)
  });
}

export function analyzeCardGraph(cards, initialState = {}) {
  const { tags: initialTags, variables: initialVariables, factions: initialFactions } = normalizeInitialSignals(initialState);
  const nodes = cards.map((card) => ({
    id: card.id,
    requirements: card.requirements ?? {}
  }));
  const producedSignalsByChoice = new Map();

  for (const card of cards) {
    producedSignalsByChoice.set(card.id, collectProducedSignalsByChoice(card));
  }

  const edges = [];
  for (const [sourceId, choiceSignals] of producedSignalsByChoice.entries()) {
    for (const target of cards) {
      const requiredTags = [
        ...(target.requirements?.allTags ?? []),
        ...(target.requirements?.anyTags ?? [])
      ];
      const requiredVariables = Object.entries(target.requirements?.variables ?? {});
      const requiredFactions = Object.entries(target.requirements?.factions ?? {});

      const enablingChoices = [];
      const aggregateEnablingTags = new Set();
      const aggregateEnablingVariables = new Set();
      const aggregateEnablingFactions = new Set();

      for (const [choiceId, signals] of choiceSignals.entries()) {
        const choiceEnablingTags = requiredTags.filter((tag) => signals.tags.has(tag));
        const choiceEnablingVariables = requiredVariables
          .filter(([variable, value]) => signalHasVariable(signals.variables, variable, value))
          .map(([variable]) => variable);
        const choiceEnablingFactions = requiredFactions
          .filter(([faction, rule]) => choiceCanEnableFactionRequirement(signals.factionDeltas, faction, rule))
          .map(([faction]) => faction);

        if (choiceEnablingTags.length > 0 || choiceEnablingVariables.length > 0 || choiceEnablingFactions.length > 0) {
          enablingChoices.push({ id: choiceId, label: signals.label });
          choiceEnablingTags.forEach((tag) => aggregateEnablingTags.add(tag));
          choiceEnablingVariables.forEach((variable) => aggregateEnablingVariables.add(variable));
          choiceEnablingFactions.forEach((faction) => aggregateEnablingFactions.add(faction));
        }
      }

      if (enablingChoices.length > 0 && sourceId !== target.id) {
        const enablingTags = [...aggregateEnablingTags];
        const enablingVariables = [...aggregateEnablingVariables];
        const enablingFactions = [...aggregateEnablingFactions];
        const edge = { from: sourceId, to: target.id, choices: enablingChoices };
        if (enablingTags.length > 0) {
          edge.tags = enablingTags;
        }
        if (enablingVariables.length > 0) {
          edge.variables = enablingVariables;
        }
        if (enablingFactions.length > 0) {
          edge.factions = enablingFactions;
        }
        edges.push(edge);
      }
    }
  }

  const producedTags = new Set(initialTrueTags(initialTags));
  const producedVariables = initialVariableSignals(initialVariables);
  const producedFactionRanges = initialFactionRanges(initialFactions);
  for (const choiceSignals of producedSignalsByChoice.values()) {
    for (const signals of choiceSignals.values()) {
      mergeSignals({ tags: producedTags, variables: producedVariables, factions: producedFactionRanges }, signals);
    }
  }

  const reachability = analyzeReachability(cards, initialTags, initialVariables, initialFactions);

  return {
    nodes,
    edges,
    isolatedCards: nodes
      .filter((node) => !edges.some((edge) => edge.from === node.id || edge.to === node.id))
      .map((node) => node.id),
    initiallyEligibleCards: reachability.initiallyEligibleCards,
    reachableCards: reachability.reachableCards,
    unreachableCards: reachability.unreachableCards,
    unsatisfiedRequiredTags: collectUnsatisfiedRequiredTags(cards, producedTags),
    unsatisfiedRequiredVariables: collectUnsatisfiedRequiredVariables(cards, producedVariables),
    unsatisfiedRequiredFactions: collectUnsatisfiedRequiredFactions(cards, producedFactionRanges)
  };
}

function normalizeReviewOptions(options) {
  return {
    cards: options.cards ?? [],
    cycles: normalizePositiveInteger(options.cycles ?? DEFAULT_CYCLES, "cycles"),
    maxTurns: normalizePositiveInteger(options.maxTurns ?? DEFAULT_MAX_TURNS, "maxTurns"),
    seed: normalizeSeed(options.seed ?? 1),
    choose: options.choose ?? chooseRandomChoice,
    initialState: cloneInitialState(options.initialState ?? {}),
    thresholds: normalizeThresholds(options.thresholds ?? {}),
    sampleLimit: normalizeNonNegativeInteger(options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT, "sampleLimit"),
    includeSampleEvents: Boolean(options.includeSampleEvents)
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
    const selectedChoiceId = resolveChoiceId(selectedChoice);

    if (!currentCard.choices.some((choice) => choice.id === selectedChoiceId)) {
      throw new ReviewerError(`Choice '${selectedChoiceId}' is not valid for card '${currentCard.id}'`);
    }

    increment(choices, `${currentCard.id}:${selectedChoiceId}`);
    const step = runtime.choose(selectedChoiceId);
    currentCard = step.nextCard;
    stalled = !runtime.state.gameOver && currentCard === null;
  }

  const terminal = terminalReason(runtime.state, stalled, options.maxTurns);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    seed: options.seed,
    turns: runtime.state.turn,
    gameOver: runtime.state.gameOver,
    stalled,
    terminalReason: terminal,
    finalFactions: { ...runtime.state.factions },
    cardVisits: Object.fromEntries(visits),
    choiceVisits: Object.fromEntries(choices),
    events: options.includeEvents ? runtime.events : undefined
  };
}

function chooseRandomChoice({ card, rng }) {
  const index = Math.floor(rng() * card.choices.length);
  return card.choices[Math.min(index, card.choices.length - 1)];
}

function resolveChoiceId(choice) {
  if (typeof choice === "string") {
    return choice;
  }

  if (!choice?.id) {
    throw new ReviewerError("choose must return a choice id string or a choice with an id");
  }

  return choice.id;
}

function createAggregate(cards) {
  return {
    cycles: 0,
    totalTurns: 0,
    stalledCycles: 0,
    gameOverCycles: 0,
    gameOverByFaction: Object.fromEntries(FACTIONS.map((faction) => [faction, 0])),
    terminalReasons: {},
    factionTotals: Object.fromEntries(FACTIONS.map((faction) => [faction, 0])),
    cardVisits: Object.fromEntries(cards.map((card) => [card.id, 0])),
    cardCycleVisits: Object.fromEntries(cards.map((card) => [card.id, 0])),
    choiceVisits: {},
    choiceCycleVisits: {},
    turnSamples: []
  };
}

function recordCycle(aggregate, result) {
  aggregate.cycles += 1;
  aggregate.totalTurns += result.turns;
  aggregate.turnSamples.push(result.turns);
  aggregate.terminalReasons[result.terminalReason] = (aggregate.terminalReasons[result.terminalReason] ?? 0) + 1;

  if (result.stalled) {
    aggregate.stalledCycles += 1;
  }

  if (result.gameOver) {
    aggregate.gameOverCycles += 1;
    aggregate.gameOverByFaction[result.gameOver.faction] += 1;
  }

  for (const faction of FACTIONS) {
    aggregate.factionTotals[faction] += result.finalFactions[faction];
  }

  for (const [cardId, count] of Object.entries(result.cardVisits)) {
    aggregate.cardVisits[cardId] = (aggregate.cardVisits[cardId] ?? 0) + count;
    if (count > 0) {
      aggregate.cardCycleVisits[cardId] = (aggregate.cardCycleVisits[cardId] ?? 0) + 1;
    }
  }

  for (const [choiceId, count] of Object.entries(result.choiceVisits)) {
    aggregate.choiceVisits[choiceId] = (aggregate.choiceVisits[choiceId] ?? 0) + count;
    if (count > 0) {
      aggregate.choiceCycleVisits[choiceId] = (aggregate.choiceCycleVisits[choiceId] ?? 0) + 1;
    }
  }
}

function buildReport({ aggregate, cards, cycles, maxTurns, seed, thresholds, sampleLimit, includeSampleEvents, samples, graph }) {
  const averageTurns = aggregate.totalTurns / cycles;
  const sortedTurns = [...aggregate.turnSamples].sort((left, right) => left - right);
  const factionAverages = Object.fromEntries(
    FACTIONS.map((faction) => [faction, round(aggregate.factionTotals[faction] / cycles)])
  );
  const cardVisitRates = Object.fromEntries(
    Object.entries(aggregate.cardVisits).map(([cardId, count]) => [cardId, round(count / cycles)])
  );
  const cardCycleRates = Object.fromEntries(
    Object.entries(aggregate.cardCycleVisits).map(([cardId, count]) => [cardId, round(count / cycles)])
  );
  const choiceCycleRates = Object.fromEntries(
    Object.entries(aggregate.choiceCycleVisits).map(([choiceId, count]) => [choiceId, round(count / cycles)])
  );
  const terminalReasonRates = Object.fromEntries(
    Object.entries(aggregate.terminalReasons).map(([reason, count]) => [reason, round(count / cycles)])
  );
  const unvisitedCards = cards.map((card) => card.id).filter((cardId) => (aggregate.cardVisits[cardId] ?? 0) === 0);
  const lowCycleCards = Object.entries(cardCycleRates)
    .filter(([, rate]) => rate > 0 && rate < thresholds.lowCardCycleRate)
    .map(([cardId, rate]) => ({ cardId, rate }));
  const coverage = {
    cardVisitRates,
    cardCycleRates,
    choiceVisits: aggregate.choiceVisits,
    choiceCycleRates,
    unvisitedCards,
    lowCycleCards
  };
  const summary = {
    averageTurns: round(averageTurns),
    minTurns: sortedTurns[0] ?? 0,
    maxTurns: sortedTurns.at(-1) ?? 0,
    turnPercentiles: {
      p10: percentile(sortedTurns, 0.1),
      p50: percentile(sortedTurns, 0.5),
      p90: percentile(sortedTurns, 0.9)
    },
    gameOverRate: round(aggregate.gameOverCycles / cycles),
    stalledRate: round(aggregate.stalledCycles / cycles),
    gameOverByFaction: aggregate.gameOverByFaction,
    terminalReasons: aggregate.terminalReasons,
    terminalReasonRates,
    factionAverages
  };
  const warnings = buildWarnings({ aggregate, cards, graph, summary, coverage, thresholds });

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    module: "ReignsAgent-Reviewer",
    parameters: { cycles, maxTurns, seed, sampleLimit, includeSampleEvents },
    thresholds,
    summary,
    coverage,
    graph,
    samples,
    diagnostics: {
      warnings,
      warningCounts: countWarningsBySeverity(warnings)
    }
  };
}

function createCycleSample(result) {
  const sample = {
    seed: result.seed,
    turns: result.turns,
    terminalReason: result.terminalReason,
    gameOver: result.gameOver,
    finalFactions: result.finalFactions,
    cardVisits: result.cardVisits,
    choiceVisits: result.choiceVisits
  };

  if (result.events) {
    sample.events = result.events;
  }

  return sample;
}

function buildWarnings({ aggregate, cards, graph, summary, coverage, thresholds }) {
  const warnings = [];

  if (coverage.unvisitedCards.length > 0) {
    warnings.push({
      code: "never_visited_cards",
      severity: "error",
      message: "Some cards were never reached during simulation.",
      cardIds: coverage.unvisitedCards
    });
  }

  if (coverage.lowCycleCards.length > 0) {
    warnings.push({
      code: "low_card_cycle_coverage",
      severity: "warning",
      message: "Some cards were reached in very few simulated cycles.",
      threshold: thresholds.lowCardCycleRate,
      cards: coverage.lowCycleCards
    });
  }

  if (summary.stalledRate > thresholds.stalledRate) {
    warnings.push({
      code: "stalled_cycles",
      severity: "error",
      message: "Some cycles ended because no eligible card was available.",
      cycles: aggregate.stalledCycles,
      rate: summary.stalledRate,
      threshold: thresholds.stalledRate
    });
  }

  if (summary.gameOverRate > thresholds.highGameOverRate) {
    warnings.push({
      code: "high_game_over_rate",
      severity: "warning",
      message: "Most simulated cycles ended in a game-over state.",
      rate: summary.gameOverRate,
      threshold: thresholds.highGameOverRate
    });
  }

  if (graph.unsatisfiedRequiredTags.length > 0) {
    warnings.push({
      code: "unsatisfied_required_tags",
      severity: "error",
      message: "Some card requirements cannot be satisfied by initial tags or card effects.",
      tags: graph.unsatisfiedRequiredTags
    });
  }

  if (graph.unsatisfiedRequiredVariables.length > 0) {
    warnings.push({
      code: "unsatisfied_required_variables",
      severity: "error",
      message: "Some variable requirements cannot be satisfied by initial variables or card effects.",
      variables: graph.unsatisfiedRequiredVariables
    });
  }

  if ((graph.unsatisfiedRequiredFactions ?? []).length > 0) {
    warnings.push({
      code: "unsatisfied_required_factions",
      severity: "error",
      message: "Some faction threshold requirements cannot be satisfied by the initial values or choice deltas.",
      factions: graph.unsatisfiedRequiredFactions
    });
  }

  if (graph.unreachableCards.length > 0) {
    warnings.push({
      code: "unreachable_cards",
      severity: "error",
      message: "Some cards cannot be reached from the initial state through declared tag or variable effects.",
      cardIds: graph.unreachableCards
    });
  }

  for (const [faction, count] of Object.entries(summary.gameOverByFaction)) {
    const rate = count / aggregate.cycles;
    if (rate > thresholds.dominantGameOverRate) {
      warnings.push({
        code: "dominant_game_over_faction",
        severity: "warning",
        message: "One faction dominates simulated endings.",
        faction,
        rate: round(rate),
        threshold: thresholds.dominantGameOverRate
      });
    }
  }

  return warnings;
}

function countWarningsBySeverity(warnings) {
  return warnings.reduce(
    (counts, warning) => {
      counts[warning.severity] = (counts[warning.severity] ?? 0) + 1;
      return counts;
    },
    { error: 0, warning: 0, info: 0 }
  );
}

function collectProducedSignals(card) {
  const tags = new Set();
  const variables = new Map();
  const factionDeltas = new Map();

  for (const choice of card.choices ?? []) {
    for (const [tag, value] of Object.entries(choice.effects?.tags ?? {})) {
      if (value !== false && value !== null && value !== undefined) {
        tags.add(tag);
      }
    }

    for (const [variable, value] of Object.entries(choice.effects?.variables ?? {})) {
      if (value !== null && value !== undefined) {
        addVariableSignal(variables, variable, value);
      }
    }

    for (const [faction, delta] of Object.entries(choice.effects?.factions ?? {})) {
      if (Number.isFinite(delta) && delta !== 0) {
        addFactionDelta(factionDeltas, faction, delta);
      }
    }

    for (const hookEntry of choice.effects?.activateHooks ?? []) {
      for (const tag of hookEntry.tags ?? []) {
        tags.add(tag);
      }
    }
  }

  return { tags, variables, factionDeltas };
}

/**
 * collectProducedSignalsByChoice traces each choice's effects separately, so the
 * graph can attribute enabling signals (tags/variables) back to specific choice
 * branches (left/right). Returns a Map keyed by choice id, with each value
 * carrying { tags, variables, factionDeltas, label } for edge attribution and display.
 */
function collectProducedSignalsByChoice(card) {
  const byChoice = new Map();

  for (const choice of card.choices ?? []) {
    const tags = new Set();
    const variables = new Map();
    const factionDeltas = new Map();

    for (const [tag, value] of Object.entries(choice.effects?.tags ?? {})) {
      if (value !== false && value !== null && value !== undefined) {
        tags.add(tag);
      }
    }

    for (const [variable, value] of Object.entries(choice.effects?.variables ?? {})) {
      if (value !== null && value !== undefined) {
        addVariableSignal(variables, variable, value);
      }
    }

    for (const [faction, delta] of Object.entries(choice.effects?.factions ?? {})) {
      if (Number.isFinite(delta) && delta !== 0) {
        addFactionDelta(factionDeltas, faction, delta);
      }
    }

    for (const hookEntry of choice.effects?.activateHooks ?? []) {
      for (const tag of hookEntry.tags ?? []) {
        tags.add(tag);
      }
    }

    byChoice.set(choice.id, { tags, variables, factionDeltas, label: choice.label ?? choice.id });
  }

  return byChoice;
}

function analyzeReachability(cards, initialTags, initialVariables, initialFactions) {
  const available = {
    tags: new Set(initialTrueTags(initialTags)),
    variables: initialVariableSignals(initialVariables),
    factions: initialFactionRanges(initialFactions)
  };
  const initiallyEligibleCards = cards
    .filter((card) => requirementsAreSatisfied(card.requirements ?? {}, available))
    .map((card) => card.id);
  const reachable = new Set();
  let changed = true;

  while (changed) {
    changed = false;

    for (const card of cards) {
      if (reachable.has(card.id) || !requirementsAreSatisfied(card.requirements ?? {}, available)) {
        continue;
      }

      reachable.add(card.id);
      mergeSignals(available, collectProducedSignals(card));
      changed = true;
    }
  }

  const reachableCards = cards.map((card) => card.id).filter((cardId) => reachable.has(cardId));

  return {
    initiallyEligibleCards,
    reachableCards,
    unreachableCards: cards.map((card) => card.id).filter((cardId) => !reachable.has(cardId))
  };
}

function requirementsAreSatisfied(requirements, available) {
  const allTags = requirements.allTags ?? [];
  const anyTags = requirements.anyTags ?? [];
  const noneTags = requirements.noneTags ?? [];
  const variables = requirements.variables ?? {};
  const factions = requirements.factions ?? {};

  return (
    allTags.every((tag) => available.tags.has(tag)) &&
    (anyTags.length === 0 || anyTags.some((tag) => available.tags.has(tag))) &&
    noneTags.every((tag) => !available.tags.has(tag)) &&
    Object.entries(variables).every(([variable, value]) => signalHasVariable(available.variables, variable, value)) &&
    Object.entries(factions).every(([faction, rule]) => factionRangeCanSatisfy(available.factions[faction], rule))
  );
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

function collectUnsatisfiedRequiredVariables(cards, producedVariables) {
  const missing = new Set();

  for (const card of cards) {
    for (const [variable, value] of Object.entries(card.requirements?.variables ?? {})) {
      if (!signalHasVariable(producedVariables, variable, value)) {
        missing.add(variable);
      }
    }
  }

  return [...missing].sort();
}

function collectUnsatisfiedRequiredFactions(cards, producedFactionRanges) {
  const missing = new Set();

  for (const card of cards) {
    for (const [faction, rule] of Object.entries(card.requirements?.factions ?? {})) {
      if (!factionRangeCanSatisfy(producedFactionRanges[faction], rule)) {
        missing.add(faction);
      }
    }
  }

  return [...missing].sort();
}

function normalizeInitialSignals(initialState) {
  if ("tags" in initialState || "variables" in initialState || "factions" in initialState) {
    return {
      tags: initialState.tags ?? {},
      variables: initialState.variables ?? {},
      factions: initialState.factions ?? {}
    };
  }

  return {
    tags: initialState,
    variables: {},
    factions: {}
  };
}

function initialTrueTags(tags) {
  return Object.entries(tags)
    .filter(([, value]) => Boolean(value))
    .map(([tag]) => tag);
}

function initialVariableSignals(variables) {
  const signals = new Map();

  for (const [variable, value] of Object.entries(variables)) {
    if (value !== null && value !== undefined) {
      addVariableSignal(signals, variable, value);
    }
  }

  return signals;
}

function initialFactionRanges(factions = {}) {
  return Object.fromEntries(
    FACTIONS.map((faction) => {
      const value = Number.isFinite(factions[faction]) ? clampFaction(factions[faction]) : DEFAULT_FACTION_VALUE;
      return [faction, { min: value, max: value }];
    })
  );
}

function mergeSignals(target, source) {
  for (const tag of source.tags) {
    target.tags.add(tag);
  }

  for (const [variable, values] of source.variables.entries()) {
    for (const value of values) {
      addVariableSignalKey(target.variables, variable, value);
    }
  }

  for (const [faction, deltas] of (source.factionDeltas ?? new Map()).entries()) {
    for (const delta of deltas) {
      expandFactionRange(target.factions, faction, delta);
    }
  }
}

function addVariableSignal(signals, variable, value) {
  addVariableSignalKey(signals, variable, stableValueKey(value));
}

function addVariableSignalKey(signals, variable, valueKey) {
  if (!signals.has(variable)) {
    signals.set(variable, new Set());
  }

  signals.get(variable).add(valueKey);
}

function signalHasVariable(signals, variable, value) {
  return signals.get(variable)?.has(stableValueKey(value)) ?? false;
}

function addFactionDelta(deltas, faction, value) {
  if (!deltas.has(faction)) {
    deltas.set(faction, new Set());
  }

  deltas.get(faction).add(value);
}

function expandFactionRange(ranges, faction, delta) {
  if (!ranges[faction]) {
    ranges[faction] = { min: DEFAULT_FACTION_VALUE, max: DEFAULT_FACTION_VALUE };
  }

  const range = ranges[faction];
  const candidates = [
    range.min,
    range.max,
    clampFaction(range.min + delta),
    clampFaction(range.max + delta)
  ];
  range.min = Math.min(...candidates);
  range.max = Math.max(...candidates);
}

function factionRangeCanSatisfy(range = { min: DEFAULT_FACTION_VALUE, max: DEFAULT_FACTION_VALUE }, rule) {
  const constraint = normalizeFactionRequirementRule(rule);
  const requiredMin = constraint.equals ?? constraint.min ?? 0;
  const requiredMax = constraint.equals ?? constraint.max ?? 100;
  return range.max >= requiredMin && range.min <= requiredMax;
}

function choiceCanEnableFactionRequirement(factionDeltas, faction, rule) {
  const deltas = factionDeltas.get(faction);
  if (!deltas || deltas.size === 0) {
    return false;
  }

  const constraint = normalizeFactionRequirementRule(rule);
  return [...deltas].some((delta) => {
    if (constraint.equals !== undefined) return true;
    if (constraint.min !== undefined && delta > 0) return true;
    if (constraint.max !== undefined && delta < 0) return true;
    return false;
  });
}

function normalizeFactionRequirementRule(rule) {
  if (Number.isFinite(rule)) {
    return { equals: rule };
  }
  return rule ?? {};
}

function clampFaction(value) {
  return Math.max(0, Math.min(100, value));
}

function stableValueKey(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableValueKey).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValueKey(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function terminalReason(state, stalled, maxTurns) {
  if (state.gameOver) {
    return `game_over:${state.gameOver.faction}`;
  }

  if (stalled) {
    return "stalled";
  }

  if (state.turn >= maxTurns) {
    return "max_turns";
  }

  return "completed";
}

function cloneInitialState(initialState) {
  return {
    ...initialState,
    factions: initialState.factions ? { ...initialState.factions } : undefined,
    variables: initialState.variables ? { ...initialState.variables } : undefined,
    activeHooks: initialState.activeHooks ? [...initialState.activeHooks] : undefined,
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
    throw new ReviewerError(`${name} must be a positive integer`);
  }

  return value;
}

function normalizeNonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ReviewerError(`${name} must be a non-negative integer`);
  }

  return value;
}

function normalizeSeed(value) {
  if (!Number.isInteger(value)) {
    throw new ReviewerError("seed must be an integer");
  }

  return value;
}

function normalizeThresholds(thresholds) {
  const normalized = {
    ...DEFAULT_THRESHOLDS,
    ...thresholds
  };

  for (const [name, value] of Object.entries(normalized)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new ReviewerError(`threshold '${name}' must be between 0 and 1`);
    }
  }

  return normalized;
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.ceil(sortedValues.length * fraction) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}
