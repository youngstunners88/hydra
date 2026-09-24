/**
 * Grade experiment permutation-brier-v1 exactly as sealed. No judgement calls.
 *
 * Pairs the two arms by wallet, keeps only wallets resolved in BOTH, and
 * compares Brier scores. The verdict is UNDERPOWERED below 97 pairs -- not a
 * weak result, not a trend, not "promising". Below the minimum there is no
 * result, and reporting one would be reading tea leaves in public.
 */

export interface ArmRecord {
  readonly answer: string;          // "0x...:watchlisted->trusted"
  readonly confidence: number;      // P(retains) in both Jev arms
  readonly outcome: boolean | null;
}

export type ExperimentVerdict = "UNDERPOWERED" | "HELD" | "FALSIFIED";

export interface PairedBrier {
  readonly pairs: number;
  readonly brierA: number;
  readonly brierB: number;
  /** brierA - brierB. Positive means B is better. */
  readonly improvement: number;
  readonly verdict: ExperimentVerdict;
  readonly minimum: number;
  readonly threshold: number;
}

export const SEALED_MINIMUM = 97;
export const SEALED_THRESHOLD = 0.02;

const walletOf = (answer: string): string => answer.split(":")[0] as string;

/**
 * `a` = single, `b` = permuted. Unresolved and unpaired records are dropped.
 * A wallet recorded twice in one arm is an error, not a choice between rows:
 * the hunter guarantees one decision per wallet, and a duplicate means that
 * guarantee broke.
 */
export function pairedBrier(
  a: readonly ArmRecord[],
  b: readonly ArmRecord[],
  minimum: number = SEALED_MINIMUM,
  threshold: number = SEALED_THRESHOLD,
): PairedBrier {
  const index = (rows: readonly ArmRecord[], arm: string) => {
    const m = new Map<string, ArmRecord>();
    for (const r of rows) {
      const w = walletOf(r.answer);
      if (m.has(w)) throw new Error(`${arm}: wallet ${w} recorded twice; one decision per wallet broke`);
      m.set(w, r);
    }
    return m;
  };
  const ia = index(a, "arm A");
  const ib = index(b, "arm B");
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (const [w, ra] of ia) {
    const rb = ib.get(w);
    if (!rb || ra.outcome === null || rb.outcome === null) continue;
    if (ra.outcome !== rb.outcome) {
      // Same wallet, same rule, near-identical decision time: the outcomes
      // should agree. If they do not, the two arms were resolved against
      // different moments and the pair is not a pair.
      throw new Error(`wallet ${w}: arms resolved to different outcomes`);
    }
    const y = ra.outcome ? 1 : 0;
    sa += (ra.confidence - y) ** 2;
    sb += (rb.confidence - y) ** 2;
    n += 1;
  }
  const brierA = n ? sa / n : Number.NaN;
  const brierB = n ? sb / n : Number.NaN;
  const improvement = brierA - brierB;
  const verdict: ExperimentVerdict = n < minimum ? "UNDERPOWERED"
    : improvement >= threshold ? "HELD" : "FALSIFIED";
  return { pairs: n, brierA, brierB, improvement, verdict, minimum, threshold };
}

// --- noul-retention-v2 -------------------------------------------------------

export interface TripleBrier {
  readonly pairs: number;
  readonly noul: number;
  readonly permuted: number;
  readonly constant: number;
  readonly verdict: ExperimentVerdict;
  readonly minimum: number;
  readonly threshold: number;
}

/**
 * Grade noul-retention-v2 as sealed: wallets resolved in ALL THREE arms.
 * HELD iff Brier(noul) <= Brier(permuted) - threshold AND
 * Brier(noul) < Brier(constant). Below the minimum: UNDERPOWERED.
 */
export function tripleBrier(
  noul: readonly ArmRecord[],
  permuted: readonly ArmRecord[],
  constant: readonly ArmRecord[],
  minimum: number = SEALED_MINIMUM,
  threshold: number = SEALED_THRESHOLD,
): TripleBrier {
  const index = (rows: readonly ArmRecord[], arm: string) => {
    const m = new Map<string, ArmRecord>();
    for (const r of rows) {
      const w = walletOf(r.answer);
      if (m.has(w)) throw new Error(`${arm}: wallet ${w} recorded twice; one decision per wallet broke`);
      m.set(w, r);
    }
    return m;
  };
  const [iN, iP, iC] = [index(noul, "noul"), index(permuted, "permuted"), index(constant, "constant")];
  let n = 0;
  let sn = 0;
  let sp = 0;
  let sc = 0;
  for (const [w, rn] of iN) {
    const rp = iP.get(w);
    const rc = iC.get(w);
    if (!rp || !rc || rn.outcome === null || rp.outcome === null || rc.outcome === null) continue;
    if (rn.outcome !== rp.outcome || rn.outcome !== rc.outcome) {
      throw new Error(`wallet ${w}: arms resolved to different outcomes`);
    }
    const y = rn.outcome ? 1 : 0;
    sn += (rn.confidence - y) ** 2;
    sp += (rp.confidence - y) ** 2;
    sc += (rc.confidence - y) ** 2;
    n += 1;
  }
  const mean = (x: number) => (n ? x / n : Number.NaN);
  const [bn, bp, bc] = [mean(sn), mean(sp), mean(sc)];
  const verdict: ExperimentVerdict = n < minimum ? "UNDERPOWERED"
    : bn <= bp - threshold && bn < bc ? "HELD" : "FALSIFIED";
  return { pairs: n, noul: bn, permuted: bp, constant: bc, verdict, minimum, threshold };
}
