/**
 * The three arms of experiment permutation-brier-v1, sealed in
 * ops/experiments/permutation-brier-v1.json before any of its data existed.
 *
 * Each arm is one journal action, so the journal calibrates them separately:
 *
 *   wallet_promotion@heuristic   transfer size -> confidence (no model)
 *   wallet_promotion@single      Jev P(retains), canonical order
 *   wallet_promotion@permuted    mean Jev P(retains) over both orderings
 *
 * The two Jev arms come from ONE request (CapturingEngine inside
 * PermutedEngine), and both are P(retains) -- the same event the sealed
 * resolution rule grades, on the same scale. Jev's own `confidence` field is
 * deliberately NOT used: it is about the argmax, not about retention, and it
 * sits ~0.1 below the top probability.
 */
import { journalAction, DecisionError } from "../jev/types.ts";
import type { ChoiceQuestion, ChoiceVerdict, ProbabilityQuestion, ProbabilityVerdict } from "../jev/types.ts";
import type { DecisionEngine } from "../jev/port.ts";
import { CapturingEngine } from "../jev/adapters/capture.ts";
import { PermutedEngine } from "../jev/adapters/permuted.ts";
import { EgressPolicy } from "../jev/egress.ts";
import { PROMOTION_ACTION } from "../promotion.ts";

export const ARM_ACTIONS = {
  heuristic: journalAction(PROMOTION_ACTION, "heuristic"),
  single: journalAction(PROMOTION_ACTION, "single"),
  permuted: journalAction(PROMOTION_ACTION, "permuted"),
} as const;

/** Canonical order: `retains` FIRST. Recorded in the seal; do not reorder. */
export const RETAIN_QUESTION: ChoiceQuestion = {
  kind: "choice",
  name: "retain",
  instructions:
    "Predict this wallet's native PLS balance six hours from now relative to " +
    "its balance now. It just sent the transfer described.",
  options: {
    retains: "At least as much native PLS six hours from now as now.",
    declines: "Less native PLS six hours from now than now.",
  },
};

/** The only state that leaves the machine. The address is not in it. */
export const RETAIN_EGRESS = new EgressPolicy(["value_pls", "balance_pls", "fraction_sent"]);

export interface RetentionFeatures {
  readonly value_pls: number;
  readonly balance_pls: number;
  readonly fraction_sent: number;
}

export function features(valuePls: number, balancePls: number): RetentionFeatures {
  if (!(valuePls >= 0) || !(balancePls >= 0)) {
    throw new DecisionError(`features need non-negative numbers; got ${valuePls}, ${balancePls}`);
  }
  const total = valuePls + balancePls;
  return {
    value_pls: valuePls,
    balance_pls: balancePls,
    // Share of the pre-transfer balance that was sent. 0 when both are 0.
    fraction_sent: total > 0 ? valuePls / total : 0,
  };
}

/** Transfer size -> confidence, clamped. The original crude heuristic. */
export function confidenceFromValue(native: number, floor: number): number {
  if (!(native > 0) || !(floor > 0)) return 0.5;
  const raw = 0.5 + Math.log10(native / floor) * 0.1;
  return Math.min(0.95, Math.max(0.05, Number(raw.toFixed(4))));
}

export interface JevForecasts {
  readonly single: number;
  readonly permuted: number;
}

/**
 * Both Jev forecasts from ONE request. Throws rather than returning a partial
 * pair: a single without its permuted twin cannot enter the paired analysis,
 * and recording it would unbalance the arms.
 */
export async function jevForecasts(
  jev: DecisionEngine,
  f: RetentionFeatures,
): Promise<JevForecasts> {
  const capture = new CapturingEngine(jev);
  const permuted = new PermutedEngine(capture, 2);
  const state = RETAIN_EGRESS.apply({ ...f }).state;
  const [agg] = (await permuted.decide(state, [RETAIN_QUESTION])) as ChoiceVerdict[];
  const canonical = capture.last.get(`${RETAIN_QUESTION.name}__ord0`) as ChoiceVerdict | undefined;
  if (!agg || !canonical || canonical.kind !== "choice") {
    throw new DecisionError("Jev did not return both orderings; no forecast recorded");
  }
  // Ordering 0 must be the canonical order, or `single` means nothing.
  const order = Object.keys(canonical.probabilities);
  if (!(order.includes("retains") && order.includes("declines"))) {
    throw new DecisionError("canonical ordering is missing an option");
  }
  return {
    single: canonical.probabilities.retains as number,
    permuted: agg.probabilities.retains as number,
  };
}

// --- noul-retention-v2 (ops/experiments/noul-retention-v2.json) ----------------

/** v2's own arms. `permuted` is v1's arm, reused as-is from the same hunt. */
export const V2_ACTIONS = {
  noul: journalAction(PROMOTION_ACTION, "noul"),
  constant: journalAction(PROMOTION_ACTION, "constant"),
} as const;

/** Sealed value of the constant arm. */
export const V2_CONSTANT = 0.5;

/**
 * Verbatim from the seal. A test checks the sealed text contains this exact
 * statement, so an edit here fails CI rather than silently changing the arm.
 * `true` means RETAINS -- the same direction as the rule's CORRECT line.
 */
export const RETAIN_NOUL: ProbabilityQuestion = {
  kind: "probability",
  name: "retain_noul",
  statement:
    "Six hours after the transfer described, the sending wallet's native PLS " +
    "balance is at least what it was at the time of the transfer.",
};

/**
 * Jev's Noul P(retains), in a request SEPARATE from v1's so v1's sealed
 * request is unchanged. Same egress, same state.
 */
export async function jevNoul(jev: DecisionEngine, f: RetentionFeatures): Promise<number> {
  const state = RETAIN_EGRESS.apply({ ...f }).state;
  const [v] = (await jev.decide(state, [RETAIN_NOUL])) as ProbabilityVerdict[];
  if (!v || v.kind !== "probability" || !(v.probability >= 0 && v.probability <= 1)) {
    throw new DecisionError("Jev returned no Noul probability; no v2 arm recorded");
  }
  return v.probability;
}
