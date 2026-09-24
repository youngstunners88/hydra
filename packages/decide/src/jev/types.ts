/**
 * Domain types for closed-set decisions. No transport, no vendor, no I/O.
 *
 * Jev (TypeSafe System One) answers questions whose answer space is CLOSED:
 * one of N named options, or a bare probability. Nothing in this file knows
 * that Jev exists -- that is the point. The router, the journal wiring and
 * every caller depend on these types; exactly one adapter knows the wire
 * format, and replacing Jev means replacing that one file.
 */

/** One of N named options. Option ids are the ONLY values the answer can take. */
export interface ChoiceQuestion {
  readonly kind: "choice";
  readonly name: string;
  /** option id -> description. Evidence in descriptions was worth 27 points. */
  readonly options: Readonly<Record<string, string>>;
  readonly instructions: string;
}

/** A bare probability that a statement is true. */
export interface ProbabilityQuestion {
  readonly kind: "probability";
  readonly name: string;
  readonly statement: string;
}

export type Question = ChoiceQuestion | ProbabilityQuestion;

/**
 * WHERE A CONFIDENCE NUMBER CAME FROM.
 *
 * These are different kinds of number and must never be averaged together:
 *
 *   single     Jev's own confidence, one option order
 *   permuted   the winner's MEAN probability across option orders -- not
 *              Jev's native confidence at all
 *   heuristic  a local rule's score, no model involved
 *
 * The sealed permutation-averaging experiment compares `single` against
 * `permuted`. Pooling them in one calibration bucket measures the mixture,
 * not either method. So the kind travels WITH the number, and
 * `journalAction()` makes it part of the journal action name -- the journal
 * calibrates per action, so two kinds structurally cannot share a bucket.
 *
 * MEASURED 2026-09-23, why this is worse than "different methods": they are
 * on DIFFERENT SCALES. Three identical calls returned Jev confidence 0.62,
 * 0.74, 0.67 while the winner's probability was 0.75, 0.82, 0.78. `single`
 * confidence sits ~0.1 below the top probability; `permuted` IS a mean top
 * probability. One gate threshold applied to both is two different gates.
 * Set each tier's Gate on its own engine's scale.
 *
 * Same measurement: identical input, identical order, confidence spread
 * 0.62-0.74. A gate at 0.7 therefore lets the SAME question through on some
 * calls and not others. Put thresholds away from where an engine's answers
 * cluster, or accept that the gate is a coin flip in that band.
 */
export type ConfidenceKind = "single" | "permuted" | "heuristic" | "noul" | "constant";
// noul       Jev's Noul probability that a statement is true: a probability
//            by construction, NOT a sharpened Choice (noul-retention-v2)
// constant   a fixed number, recorded so a baseline lives in the journal

export interface ChoiceVerdict {
  readonly question: string;
  readonly kind: "choice";
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidenceKind: ConfidenceKind;
  /** Which engine produced this. Set by the router; audit only. */
  readonly engine: string;
}

export interface ProbabilityVerdict {
  readonly question: string;
  readonly kind: "probability";
  readonly probability: number;
  readonly confidenceKind: ConfidenceKind;
  readonly engine: string;
}

export type Verdict = ChoiceVerdict | ProbabilityVerdict;

/** Top-minus-runner-up. 0.51/0.49 and 0.51/0.05 are different findings. */
export function margin(v: ChoiceVerdict): number {
  const ranked = Object.values(v.probabilities).sort((a, b) => b - a);
  return ranked.length > 1 ? (ranked[0] as number) - (ranked[1] as number) : (ranked[0] ?? 0);
}

/**
 * The journal action a verdict must be recorded under.
 *
 * `wallet_promotion` + permuted -> `wallet_promotion@permuted`. The journal
 * computes calibration per action, so this is the mechanism -- not a
 * convention -- that keeps confidence kinds out of each other's buckets.
 */
export function journalAction(base: string, kind: ConfidenceKind): string {
  if (!/^[a-z][a-z0-9_]*$/.test(base)) {
    throw new Error(`journal action base must be snake_case; got ${JSON.stringify(base)}`);
  }
  return `${base}@${kind}`;
}

export class DecisionError extends Error {}
