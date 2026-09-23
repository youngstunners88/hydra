/**
 * The decision-engine PORT. Everything above depends on this; everything
 * below implements it.
 *
 *   router / promotion / scripts      depend on  DecisionEngine
 *   JevHttpEngine / PermutedEngine /   implement DecisionEngine
 *   HeuristicEngine / FakeEngine
 *
 * `state` is what the engine reasons over. It crosses a process boundary for
 * any remote engine, so it arrives here ALREADY passed through an
 * EgressPolicy -- an engine never decides for itself what may leave.
 */
import type { Question, Verdict } from "./types.ts";

export type DecisionState = Readonly<Record<string, unknown>>;

export interface DecisionEngine {
  /** Stable id, recorded on every verdict for audit. */
  readonly id: string;
  /** True if calling this sends `state` off the machine. */
  readonly remote: boolean;
  decide(state: DecisionState, questions: readonly Question[]): Promise<readonly Verdict[]>;
}
