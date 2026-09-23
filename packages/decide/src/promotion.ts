/**
 * The wiring: lifecycle promotions become journalled decisions.
 *
 * WHAT WAS BROKEN
 *
 * `lifecycle.ts` refuses `watchlisted -> trusted` without `paperMetricsPassed`,
 * and `journal.ts` can DERIVE that flag from resolved outcomes. But nothing
 * connected them. `LifecycleGateContext.paperMetricsPassed` was a boolean the
 * caller handed in, so the gate was satisfied by whoever wanted through it,
 * and the journal was a library no hunter ever wrote to.
 *
 * That is why the paper clock had never started: the clock is the age of the
 * oldest journalled decision, and there were none.
 *
 * WHAT THIS DOES
 *
 * `promote()` is the only supported way to move a wallet up a rank. It:
 *
 *   1. records the promotion as a decision, with the confidence that drove it,
 *      BEFORE asking whether it is allowed -- so a refused promotion is still
 *      in the record. A journal that only contains decisions that went ahead
 *      cannot be calibrated: every "no" is a prediction too.
 *   2. derives `paperMetricsPassed` from the journal, never from the caller.
 *   3. returns the decision id, which is what `resolve()` needs later.
 *
 * PLANE
 *
 * DECISION plane (SPEC section 1: "score/risk/promote"). It signs nothing,
 * touches no venue and holds no key. It imports neither hunter nor exec;
 * ops/layers.json and scripts/check_layers.ts enforce that.
 */

import { canTransition } from "./lifecycle.ts";
import type { HunterLifecycleState, LifecycleGateContext } from "./lifecycle.ts";

/**
 * The narrow slice of the decision journal this needs.
 *
 * Structural rather than an import of `@hydra/risk`, for two reasons. The
 * hunt plane should depend on the smallest surface it actually uses, and
 * stating that surface here makes it obvious that promotion can READ
 * calibration and WRITE a decision, and can do nothing else -- it cannot
 * revise a threshold, and it cannot resolve an outcome. Resolving is a
 * separate act at a separate time by whoever saw what reality did.
 */
export interface PromotionJournal {
  record(action: string, answer: string, confidence: number, note?: string): { id: string };
  paperMetricsPassed(
    action: string,
    opts: { baseline: number; margin?: number; minResolved?: number },
  ): { passed: boolean; reason: string };
}

export interface PromotionRequest {
  readonly walletId: string;
  readonly from: HunterLifecycleState;
  readonly to: HunterLifecycleState;
  /** How sure the hunter is that this promotion is right. Journalled as-is. */
  readonly confidence: number;
  /** Everything EXCEPT paperMetricsPassed, which is derived here. */
  readonly gates: Omit<LifecycleGateContext, "paperMetricsPassed">;
  readonly note?: string;
}

export interface PromotionOutcome {
  readonly allowed: boolean;
  /** The journal id. Pass it to `resolve()` when reality reports back. */
  readonly decisionId: string;
  readonly reason: string;
  readonly paperMetricsPassed: boolean;
  readonly paperMetricsReason: string;
}

/** The journal action name every promotion is recorded under. */
export const PROMOTION_ACTION = "wallet_promotion";

/**
 * The baseline a promotion must beat.
 *
 * NOT 0.5. A coin flip is the wrong baseline for a decision that is not
 * symmetric: most watchlisted wallets do not deserve promotion, so predicting
 * "no" every time already scores well above half. The baseline is supplied by
 * the caller precisely so it has to be thought about, and this constant only
 * documents why there is no default.
 */
export interface PromotionPolicy {
  readonly baseline: number;
  readonly margin?: number;
  readonly minResolved?: number;
}

export function promote(
  journal: PromotionJournal,
  request: PromotionRequest,
  policy: PromotionPolicy,
): PromotionOutcome {
  const verdict = journal.paperMetricsPassed(PROMOTION_ACTION, {
    baseline: policy.baseline,
    margin: policy.margin,
    minResolved: policy.minResolved,
  });

  // Recorded BEFORE the gate is evaluated. A refused promotion is a
  // prediction that the wallet was not ready, and it belongs in the
  // calibration set exactly as much as an accepted one does.
  const record = journal.record(
    PROMOTION_ACTION,
    `${request.walletId}:${request.from}->${request.to}`,
    request.confidence,
    request.note ?? "",
  );

  const gates: LifecycleGateContext = {
    ...request.gates,
    paperMetricsPassed: verdict.passed,
  };
  const result = canTransition(request.from, request.to, gates);

  return {
    allowed: result.ok,
    decisionId: record.id,
    reason: result.ok ? `${request.from} -> ${request.to} allowed` : result.error,
    paperMetricsPassed: verdict.passed,
    paperMetricsReason: verdict.reason,
  };
}
