/**
 * The second write: turn pending promotion decisions into resolved outcomes.
 *
 * Every decision gets exactly one of three fates per run:
 *
 *   RESOLVED     read both balances, judged under the sealed rule, written once
 *   IMMATURE     horizon not reached yet -- left pending, tried again next run
 *   UNREADABLE   a read failed -- left pending, reason reported
 *
 * The asymmetry is the whole design. IMMATURE and UNREADABLE are NEVER
 * resolved as incorrect. Defaulting an unknown to "wrong" would bias the
 * calibration toward whatever the RPC endpoint happened to be doing, and it
 * would do so silently -- the Brier score would move and nothing would say why.
 */

import { HORIZON_HOURS, RULE_ID, judge } from "./rule.ts";
import { blockAtOrBefore } from "./chain.ts";
import type { BlockHeader, ChainReader } from "./chain.ts";

export interface PendingDecision {
  readonly id: string;
  readonly action: string;
  readonly answer: string;
  /** Epoch ms, as recorded by the journal. */
  readonly at: number;
}

export interface ResolvingJournal {
  pending(action?: string): readonly PendingDecision[];
  resolve(id: string, wasCorrect: boolean): unknown;
}

export type Fate =
  | { kind: "resolved"; id: string; wallet: string; correct: boolean; t0: number; t1: number; before: bigint; after: bigint }
  | { kind: "immature"; id: string; maturesAt: number }
  | { kind: "unreadable"; id: string; reason: string };

export interface ResolveReport {
  readonly rule: string;
  readonly fates: readonly Fate[];
  readonly resolved: number;
  readonly immature: number;
  readonly unreadable: number;
}

const ANSWER = /^(0x[0-9a-f]{40}):watchlisted->trusted$/;

/** Pull the wallet out of a promotion answer. Strict: anything else is unreadable. */
export function walletFromAnswer(answer: string): string | null {
  const m = ANSWER.exec(answer);
  return m ? (m[1] as string) : null;
}

export async function resolvePending(
  journal: ResolvingJournal,
  reader: ChainReader,
  action: string,
  nowMs: number = Date.now(),
): Promise<ResolveReport> {
  const horizonMs = HORIZON_HOURS * 3_600_000;
  const pending = journal.pending(action);
  const fates: Fate[] = [];

  let head: BlockHeader | undefined;

  for (const d of pending) {
    const maturesAt = d.at + horizonMs;
    // Maturity is checked against the local clock first -- cheap, no reads --
    // and against the chain head below, because the head can lag wall time.
    if (maturesAt > nowMs) {
      fates.push({ kind: "immature", id: d.id, maturesAt });
      continue;
    }
    const wallet = walletFromAnswer(d.answer);
    if (!wallet) {
      fates.push({ kind: "unreadable", id: d.id, reason: `answer not a promotion: ${d.answer}` });
      continue;
    }
    try {
      head ??= await reader.head();
      if (Math.floor(maturesAt / 1000) > head.timestamp) {
        fates.push({ kind: "immature", id: d.id, maturesAt });
        continue;
      }
      const t0 = await blockAtOrBefore(reader, Math.floor(d.at / 1000), head);
      const t1 = await blockAtOrBefore(reader, Math.floor(maturesAt / 1000), head);
      if (t1.number <= t0.number) {
        fates.push({ kind: "unreadable", id: d.id, reason: `horizon block ${t1.number} not after decision block ${t0.number}` });
        continue;
      }
      const before = await reader.balanceAt(wallet, t0.number);
      const after = await reader.balanceAt(wallet, t1.number);
      const correct = judge(before, after);
      // The write happens LAST, after every read succeeded. A throw anywhere
      // above leaves the decision pending rather than half-judged.
      journal.resolve(d.id, correct);
      fates.push({ kind: "resolved", id: d.id, wallet, correct, t0: t0.number, t1: t1.number, before, after });
    } catch (e) {
      fates.push({ kind: "unreadable", id: d.id, reason: (e as Error).message });
    }
  }

  return {
    rule: RULE_ID,
    fates,
    resolved: fates.filter((f) => f.kind === "resolved").length,
    immature: fates.filter((f) => f.kind === "immature").length,
    unreadable: fates.filter((f) => f.kind === "unreadable").length,
  };
}
