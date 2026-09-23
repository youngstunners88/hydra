import type { Result } from "@hydra/core";
import { err, ok } from "@hydra/core";

export type HunterLifecycleState =
  | "observed"
  | "candidate"
  | "scored"
  | "watchlisted"
  | "trusted"
  | "copy_enabled"
  | "retired";

export interface LifecycleTransition {
  from: HunterLifecycleState;
  to: HunterLifecycleState;
}

export interface LifecycleGateContext {
  hasValidAddress: boolean;
  hasAtLeastOneSource: boolean;
  hasProfileAndSecurityFeatures: boolean;
  meetsWatchMinScore: boolean;
  isNotSybil: boolean;
  paperMetricsPassed: boolean;
  isConfirmedByHumanOrAutoPromote: boolean;
}

export type LifecycleError = string;

/**
 * Explicit adjacency table for hunter lifecycle states.
 *
 * This table permits only single-step lifecycle moves. There is deliberately
 * no entry from `observed` to `copy_enabled`, nor from any rank to a rank more
 * than one step ahead. Because `canTransition` compares against this adjacency
 * table and returns a Result before evaluating gates, a caller physically
 * cannot jump multiple ranks without passing each intermediate gate.
 */
const LIFECYCLE_TRANSITIONS: Record<
  HunterLifecycleState,
  ReadonlyArray<HunterLifecycleState>
> = {
  observed: ["candidate", "retired"],
  candidate: ["scored", "retired"],
  scored: ["watchlisted", "retired"],
  watchlisted: ["trusted", "retired"],
  trusted: ["copy_enabled", "retired"],
  copy_enabled: ["retired"],
  retired: [],
};

export function canTransition(
  from: HunterLifecycleState,
  to: HunterLifecycleState,
  gates: LifecycleGateContext,
): Result<LifecycleTransition, LifecycleError> {
  const allowedTargets = LIFECYCLE_TRANSITIONS[from];
  if (!allowedTargets.includes(to)) {
    return err(`transition ${from} -> ${to} is not allowed`);
  }

  switch (`${from}->${to}`) {
    case "observed->candidate": {
      if (!gates.hasValidAddress) {
        return err("observed -> candidate requires a valid address");
      }
      if (!gates.hasAtLeastOneSource) {
        return err("observed -> candidate requires at least one source");
      }
      break;
    }
    case "candidate->scored": {
      if (!gates.hasProfileAndSecurityFeatures) {
        return err(
          "candidate -> scored requires profile and security features",
        );
      }
      break;
    }
    case "scored->watchlisted": {
      if (!gates.meetsWatchMinScore) {
        return err("scored -> watchlisted requires meeting watch min score");
      }
      if (!gates.isNotSybil) {
        return err("scored -> watchlisted refuses sybil wallets");
      }
      break;
    }
    case "watchlisted->trusted": {
      if (!gates.paperMetricsPassed) {
        return err(
          "watchlisted -> trusted requires paper-copy metrics to pass",
        );
      }
      break;
    }
    case "trusted->copy_enabled": {
      if (!gates.isConfirmedByHumanOrAutoPromote) {
        return err(
          "trusted -> copy_enabled requires human confirm or AUTO_PROMOTE extra gates",
        );
      }
      break;
    }
    default: {
      // Retirement is an explicit gate-allowed escape hatch for every active
      // state and needs no extra lifecycle-specific condition here.
      break;
    }
  }

  return ok({ from, to });
}
