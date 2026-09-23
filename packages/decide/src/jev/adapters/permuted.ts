/**
 * Permutation averaging as a DECORATOR: a DecisionEngine wrapping another.
 *
 * Measured 2026-09-22 on 14 recorded cases x 6 orderings: Jev's argmax flips
 * on 29% of cases from option ORDER alone. Accuracy was unchanged (92.9%
 * either way) -- averaging buys reproducibility, not accuracy.
 *
 * Being a decorator is the design. The router, the journal wiring and every
 * caller see an ordinary DecisionEngine; turning averaging on or off is a
 * composition choice at the control plane, and nothing downstream changes --
 * EXCEPT the confidenceKind, which becomes "permuted" so the journal files it
 * under a separate action and it never shares a bucket with "single".
 *
 * All orderings go in ONE request to the inner engine. One request is the
 * entire cost argument; a round trip per ordering would spend it.
 */
import { DecisionError } from "../types.ts";
import type { ChoiceQuestion, ChoiceVerdict, Question, Verdict } from "../types.ts";
import type { DecisionEngine, DecisionState } from "../port.ts";

/** Measured token ceiling for one request, in option-judgements, with headroom. */
export const SAFE_OPTION_JUDGEMENTS = 2000;

export function orderings(labels: readonly string[], m: number, seed = 1): string[][] {
  if (m < 1) throw new DecisionError("need at least one ordering");
  let fact = 1;
  for (let i = 2; i <= labels.length && fact < m; i += 1) fact *= i;
  const want = Math.min(m, fact);
  const out = new Map<string, string[]>([[labels.join("\u0000"), [...labels]]]);
  // Deterministic LCG so a run is reproducible from its seed.
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  while (out.size < want) {
    const a = [...labels];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j] as string, a[i] as string];
    }
    out.set(a.join("\u0000"), a);
  }
  return [...out.values()];
}

export class PermutedEngine implements DecisionEngine {
  readonly id: string;
  readonly remote: boolean;
  readonly #inner: DecisionEngine;
  readonly #m: number;
  readonly #seed: number;

  constructor(inner: DecisionEngine, m = 6, seed = 1) {
    this.#inner = inner;
    this.#m = m;
    this.#seed = seed;
    this.id = `permuted(${m}):${inner.id}`;
    this.remote = inner.remote;
  }

  async decide(state: DecisionState, questions: readonly Question[]): Promise<readonly Verdict[]> {
    const expanded: Question[] = [];
    const groups = new Map<string, { q: ChoiceQuestion; names: string[] }>();
    let budget = 0;
    for (const q of questions) {
      if (q.kind !== "choice") { expanded.push(q); continue; }
      const labels = Object.keys(q.options);
      const orders = orderings(labels, this.#m, this.#seed);
      budget += orders.length * labels.length;
      const names = orders.map((order, i) => {
        const name = `${q.name}__ord${i}`;
        expanded.push({ ...q, name, options: Object.fromEntries(order.map((l) => [l, q.options[l] as string])) });
        return name;
      });
      groups.set(q.name, { q, names });
    }
    if (budget > SAFE_OPTION_JUDGEMENTS) {
      throw new DecisionError(
        `${budget} option-judgements exceeds the measured safe ceiling of ` +
          `${SAFE_OPTION_JUDGEMENTS}; the API returns HTTP 400 rather than degrading`,
      );
    }
    const taken = new Set(expanded.map((q) => q.name));
    if (taken.size !== expanded.length) {
      throw new DecisionError("a question name collides with a generated ordering name");
    }
    const byName = new Map((await this.#inner.decide(state, expanded)).map((v) => [v.question, v]));
    return questions.map((q) => {
      const g = groups.get(q.name);
      if (!g) {
        const v = byName.get(q.name);
        if (!v) throw new DecisionError(`${q.name}: inner engine returned no verdict`);
        return v;
      }
      return this.#aggregate(g.q, g.names.map((n) => {
        const v = byName.get(n);
        if (!v || v.kind !== "choice") throw new DecisionError(`${n}: missing ordering verdict`);
        return v;
      }));
    });
  }

  #aggregate(q: ChoiceQuestion, vs: readonly ChoiceVerdict[]): ChoiceVerdict {
    const labels = Object.keys(q.options);
    const mean: Record<string, number> = {};
    for (const l of labels) {
      // Renormalise per ordering first: an un-normalised average silently
      // weights whichever ordering the model was sloppiest on.
      mean[l] = vs.reduce((s, v) => {
        const mass = Object.values(v.probabilities).reduce((a, b) => a + b, 0);
        return s + (v.probabilities[l] as number) / mass;
      }, 0) / vs.length;
    }
    const choice = labels.reduce((a, b) => ((mean[b] as number) > (mean[a] as number) ? b : a));
    return {
      question: q.name, kind: "choice", choice,
      confidence: mean[choice] as number,   // NOT Jev's native confidence
      probabilities: mean, confidenceKind: "permuted", engine: this.id,
    };
  }
}
