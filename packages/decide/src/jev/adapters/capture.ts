/**
 * A decorator that records what the engine it wraps returned.
 *
 * Exists for one reason: to take the single-order answer and the permuted
 * answer from the SAME request. Wrap Jev in this, wrap that in a
 * PermutedEngine, and ordering 0's raw verdict -- the canonical order -- is
 * sitting in `last`. A separate single-order call would add call-to-call
 * noise (measured: 0.62-0.74 confidence on identical input) to every paired
 * difference; the same call cancels it.
 */
import type { Question, Verdict } from "../types.ts";
import type { DecisionEngine, DecisionState } from "../port.ts";

export class CapturingEngine implements DecisionEngine {
  readonly id: string;
  readonly remote: boolean;
  readonly #inner: DecisionEngine;
  /** Verdicts from the most recent call, by question name. */
  last: ReadonlyMap<string, Verdict> = new Map();

  constructor(inner: DecisionEngine) {
    this.#inner = inner;
    this.id = inner.id;
    this.remote = inner.remote;
  }

  async decide(state: DecisionState, questions: readonly Question[]): Promise<readonly Verdict[]> {
    this.last = new Map();
    const out = await this.#inner.decide(state, questions);
    this.last = new Map(out.map((v) => [v.question, v]));
    return out;
  }
}
