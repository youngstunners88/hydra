/**
 * A decision cascade: cheap tier first, escalate only what its gate rejects.
 *
 *   tier 0  local heuristic  (free, instant, nothing leaves the machine)
 *   tier 1  Jev              (remote, ~0.4 s, state crosses the egress policy)
 *
 * THREE RULES, each enforced at construction or per call:
 *
 * 1. A cascade must be worth having. With tier costs c0 < c1 and an expected
 *    escalation rate p, the cascade costs c0 + p*c1 against c1 for going
 *    straight to the top. It wins iff  p < 1 - c0/c1. A config that cannot win
 *    is refused -- otherwise the "optimisation" is pure added latency.
 * 2. A REMOTE tier cannot be constructed without an EgressPolicy. What leaves
 *    the process is decided here, once, not by each engine.
 * 3. UNDECIDED is a first-class result. If the last tier's verdict fails its
 *    gate, or a tier throws, the question is UNDECIDED with the reason. A
 *    sub-gate answer is never passed off as a decision, and a failed remote
 *    call never silently falls back to the cheap tier's rejected guess.
 *
 * Questions are batched per tier: everything goes to tier 0 in one call, and
 * everything tier 0's gate rejected goes to tier 1 in one call.
 */
import { DecisionError, margin } from "./types.ts";
import type { Question, Verdict } from "./types.ts";
import type { DecisionEngine, DecisionState } from "./port.ts";
import type { EgressPolicy } from "./egress.ts";

export interface Gate {
  /** Choice: minimum confidence AND minimum top-minus-runner-up margin. */
  readonly minConfidence: number;
  readonly minMargin: number;
  /** Probability: decided only outside (low, high). */
  readonly high: number;
  readonly low: number;
}

export const DEFAULT_GATE: Gate = { minConfidence: 0.7, minMargin: 0.25, high: 0.8, low: 0.2 };

export interface Tier {
  readonly engine: DecisionEngine;
  readonly gate: Gate;
  /** Relative cost of one call. Only ratios matter. */
  readonly cost: number;
  readonly egress?: EgressPolicy;
}

export type Routed =
  | { readonly status: "decided"; readonly verdict: Verdict; readonly tier: number }
  | { readonly status: "undecided"; readonly question: string; readonly reason: string;
      readonly best?: Verdict };

/** Tolerance so a verdict sitting exactly on a threshold is not lost to float noise. */
const EPS = 1e-9;

export function passes(v: Verdict, g: Gate): boolean {
  if (v.kind === "probability") return v.probability >= g.high - EPS || v.probability <= g.low + EPS;
  return v.confidence >= g.minConfidence - EPS && margin(v) >= g.minMargin - EPS;
}

/** p < 1 - c0/c1: the escalation rate below which a two-tier cascade is cheaper. */
export function breakEvenEscalation(c0: number, c1: number): number {
  if (!(c0 >= 0) || !(c1 > 0)) throw new DecisionError("costs must be c0 >= 0, c1 > 0");
  return 1 - c0 / c1;
}

export class DecisionRouter {
  readonly #tiers: readonly Tier[];
  #asked = 0;
  #escalated = 0;

  constructor(tiers: readonly Tier[], opts: { expectedEscalation?: number } = {}) {
    if (tiers.length === 0) throw new DecisionError("a router needs at least one tier");
    for (const [i, t] of tiers.entries()) {
      if (t.engine.remote && !t.egress) {
        throw new DecisionError(
          `tier ${i} (${t.engine.id}) is remote but has no EgressPolicy. Deciding ` +
            "what leaves the process is the router's job, not the engine's.",
        );
      }
      const g = t.gate;
      if (!(g.low < g.high)) throw new DecisionError(`tier ${i}: gate low must be < high`);
    }
    for (let i = 1; i < tiers.length; i += 1) {
      const prev = tiers[i - 1] as Tier;
      const cur = tiers[i] as Tier;
      if (!(prev.cost < cur.cost)) {
        throw new DecisionError(
          `tier ${i - 1} costs ${prev.cost}, tier ${i} costs ${cur.cost}: a cascade ` +
            "must get MORE expensive as it escalates, or the cheap tier is not cheap",
        );
      }
    }
    if (tiers.length >= 2 && opts.expectedEscalation !== undefined) {
      const be = breakEvenEscalation((tiers[0] as Tier).cost, (tiers[1] as Tier).cost);
      if (opts.expectedEscalation >= be) {
        throw new DecisionError(
          `expected escalation ${opts.expectedEscalation} >= break-even ${be.toFixed(3)}: ` +
            "this cascade costs more than going straight to the top tier",
        );
      }
    }
    this.#tiers = tiers;
  }

  async route(state: DecisionState, questions: readonly Question[]): Promise<readonly Routed[]> {
    const result = new Map<string, Routed>();
    let pending = [...questions];
    const best = new Map<string, Verdict>();
    this.#asked += questions.length;

    for (const [i, tier] of this.#tiers.entries()) {
      if (pending.length === 0) break;
      if (i > 0) this.#escalated += pending.length;
      const sent = tier.egress ? tier.egress.apply(state).state : state;
      let verdicts: readonly Verdict[];
      try {
        verdicts = await tier.engine.decide(sent, pending);
      } catch (e) {
        // A failed tier ends the cascade for these questions. Never fall back
        // to a lower tier's REJECTED verdict as though it had passed.
        for (const q of pending) {
          result.set(q.name, { status: "undecided", question: q.name,
            reason: `tier ${i} (${tier.engine.id}) failed: ${(e as Error).message}`,
            best: best.get(q.name) });
        }
        pending = [];
        break;
      }
      const byName = new Map(verdicts.map((v) => [v.question, v]));
      const next: Question[] = [];
      for (const q of pending) {
        const v = byName.get(q.name);
        if (!v) {
          result.set(q.name, { status: "undecided", question: q.name,
            reason: `tier ${i} returned no verdict`, best: best.get(q.name) });
          continue;
        }
        best.set(q.name, v);
        if (passes(v, tier.gate)) result.set(q.name, { status: "decided", verdict: v, tier: i });
        else next.push(q);
      }
      pending = next;
    }
    for (const q of pending) {
      result.set(q.name, { status: "undecided", question: q.name,
        reason: "no tier's verdict cleared its gate", best: best.get(q.name) });
    }
    return questions.map((q) => result.get(q.name) as Routed);
  }

  /** Observed escalation rate, to check the break-even assumption against reality. */
  stats(): { asked: number; escalated: number; rate: number } {
    return { asked: this.#asked, escalated: this.#escalated,
      rate: this.#asked ? this.#escalated / this.#asked : 0 };
  }
}
