/**
 * Two-phase ratchet exit (Hydra's DSL).
 *
 * Hydra's risk port is PRE-trade only: `checkOrder` decides whether an order
 * may be placed and then nothing owns the position. That gap is where the money
 * is. Senpi, which runs 114 strategy packages on Hyperliquid, says in its own
 * README that the exit asymmetry -- "lose small, let winners run" -- is "the
 * engine behind every strategy template". Not the entry signal. The exit.
 *
 * Phase 1 (survive): a hard floor below entry cuts losers fast.
 * Phase 2 (lock):     once a winner clears a tier's trigger, the floor ratchets
 *                     up to a share of the high-water mark and never descends.
 *
 * This module is PURE. No clock, no I/O, no mutation of its inputs. It sits in
 * @hydra/risk because it is a risk control, and it must never import from
 * hunter or exec -- the two-plane rule in CLAUDE.md.
 *
 * TWO CONSTRUCTION-TIME REFUSALS, both from Senpi's documented footguns:
 *
 *   1. A tier locking 0% is refused. It exits flat while still paying both
 *      sides' costs, which is a loss wearing a neutral face.
 *   2. Unsorted tiers are refused. An unsorted ladder silently applies the
 *      wrong rung, and nothing surfaces the error.
 *
 * Both raise when the ladder is BUILT, not when a position is open. Discovering
 * a bad ladder at tick time means discovering it with money at stake.
 */

export type CloseReason =
  | "phase1_stop"    // hard floor from entry, before any tier armed
  | "tier_breach"    // fell back through a locked rung
  | "weak_peak"      // never got going inside the grace window
  | "hard_timeout";  // out of time regardless of value

export interface Tier {
  /** Percent gain from entry that arms this rung. */
  readonly triggerPct: number;
  /** Percent of the high-water mark this rung locks in. Must exceed 0. */
  readonly lockHwPct: number;
}

export interface Ladder {
  /** Positive distance below entry, in percent, for the phase-1 floor. */
  readonly maxLossPct: number;
  readonly tiers: readonly Tier[];
  /** Ticks after which the position closes regardless of value. */
  readonly hardTimeoutTicks?: number;
  /** If by this tick the peak never cleared weakPeakMinPct, it is dead weight. */
  readonly weakPeakAfterTicks?: number;
  readonly weakPeakMinPct?: number;
}

export interface RatchetState {
  readonly entry: number;
  readonly peakPct: number;
  /** -1 means phase 1: no rung armed yet. */
  readonly tierIndex: number;
  readonly ticks: number;
  readonly closed: CloseReason | null;
}

export class LadderError extends Error {}

export function makeLadder(spec: Ladder): Ladder {
  if (!(spec.maxLossPct > 0)) {
    throw new LadderError(
      `maxLossPct is a positive distance below entry; got ${spec.maxLossPct}`,
    );
  }
  const triggers = spec.tiers.map((t) => t.triggerPct);
  for (let i = 1; i < triggers.length; i += 1) {
    if (triggers[i]! <= triggers[i - 1]!) {
      throw new LadderError(
        `tiers must be sorted ascending by triggerPct and unique -- an ` +
          `unsorted ladder applies the wrong rung silently; got [${triggers}]`,
      );
    }
  }
  for (const t of spec.tiers) {
    if (!(t.lockHwPct > 0)) {
      throw new LadderError(
        `tier at ${t.triggerPct}% locks ${t.lockHwPct}% of the peak. A rung ` +
          `that locks 0 exits flat while still paying both sides' costs, ` +
          `which is a loss dressed as breakeven.`,
      );
    }
    if (t.lockHwPct > 100) {
      throw new LadderError(
        `tier at ${t.triggerPct}% locks ${t.lockHwPct}% -- a floor above the ` +
          `high-water mark closes instantly on arrival.`,
      );
    }
    if (!(t.triggerPct > 0)) {
      throw new LadderError(`triggerPct must be above entry; got ${t.triggerPct}`);
    }
  }
  if (spec.hardTimeoutTicks !== undefined && spec.hardTimeoutTicks < 1) {
    throw new LadderError("hardTimeoutTicks must be at least one tick");
  }
  if (spec.weakPeakAfterTicks !== undefined && spec.weakPeakAfterTicks < 1) {
    throw new LadderError("weakPeakAfterTicks must be at least one tick");
  }
  return Object.freeze({ ...spec, tiers: Object.freeze([...spec.tiers]) });
}

export function openPosition(entry: number): RatchetState {
  if (!(entry > 0)) throw new LadderError("entry must be positive");
  return { entry, peakPct: 0, tierIndex: -1, ticks: 0, closed: null };
}

/** The live stop, as a percentage move from entry. Negative while in phase 1. */
export function floorPct(ladder: Ladder, state: RatchetState): number {
  if (state.tierIndex < 0) return -ladder.maxLossPct;
  const tier = ladder.tiers[state.tierIndex]!;
  return (state.peakPct * tier.lockHwPct) / 100;
}

/**
 * Advance one observation. Returns a NEW state.
 *
 * Evaluation order is timeout -> dead weight -> floor breach -> tier advance,
 * and it matters. Checking advance first would let a position that spiked and
 * collapsed inside one tick arm a rung it never actually held.
 */
export function tick(ladder: Ladder, state: RatchetState, value: number): RatchetState {
  if (state.closed !== null) return state;

  const ticks = state.ticks + 1;
  const pct = ((value - state.entry) / state.entry) * 100;
  const peakPct = Math.max(state.peakPct, pct);
  const next: RatchetState = { ...state, ticks, peakPct };

  if (ladder.hardTimeoutTicks !== undefined && ticks >= ladder.hardTimeoutTicks) {
    return { ...next, closed: "hard_timeout" };
  }
  if (
    ladder.weakPeakAfterTicks !== undefined &&
    ticks >= ladder.weakPeakAfterTicks &&
    peakPct < (ladder.weakPeakMinPct ?? 0) &&
    state.tierIndex < 0
  ) {
    return { ...next, closed: "weak_peak" };
  }
  if (pct <= floorPct(ladder, next)) {
    return { ...next, closed: next.tierIndex < 0 ? "phase1_stop" : "tier_breach" };
  }

  // Advance to the highest rung the PEAK has earned. Using peak rather than the
  // current value means the ratchet only ever tightens: a pullback cannot
  // un-arm a rung that was already reached.
  let tierIndex = next.tierIndex;
  ladder.tiers.forEach((t, i) => {
    if (peakPct >= t.triggerPct && i > tierIndex) tierIndex = i;
  });
  return { ...next, tierIndex };
}

/** Replay a whole series. For tests and paper-copy replay. */
export function run(ladder: Ladder, entry: number, values: readonly number[]): RatchetState {
  let state = openPosition(entry);
  for (const v of values) {
    state = tick(ladder, state, v);
    if (state.closed !== null) break;
  }
  return state;
}
