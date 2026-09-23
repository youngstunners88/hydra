/**
 * A local, deterministic engine: answers from a function, sends nothing.
 *
 * Two uses. In tests it replaces the network. In production it is the cheap
 * FIRST tier of a cascade -- a heuristic that answers the easy cases locally
 * so only the hard ones pay for a remote call and leave the machine.
 */
import type { Question, Verdict } from "../types.ts";
import type { DecisionEngine, DecisionState } from "../port.ts";

export type Answerer = (state: DecisionState, q: Question) => Omit<Verdict, "engine" | "question">;

export class ScriptedEngine implements DecisionEngine {
  readonly id: string;
  readonly remote = false;
  readonly #answer: Answerer;
  calls = 0;

  constructor(id: string, answer: Answerer) {
    this.id = id;
    this.#answer = answer;
  }

  async decide(state: DecisionState, questions: readonly Question[]): Promise<readonly Verdict[]> {
    this.calls += 1;
    return questions.map((q) => ({ ...this.#answer(state, q), question: q.name, engine: this.id }) as Verdict);
  }
}
