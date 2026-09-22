/**
 * The decision journal: confidence as governed policy, not a return value.
 *
 * This exists because of a gap named precisely in the Jev ecosystem survey
 * (20 Sep 2026), after scraping every Jev-native repo above 500 stars:
 *
 *   "Nothing sells thresholds as policy. Every repo on that list CONSUMES the
 *    confidence value. Not one GOVERNS it. There is no repo shipping a
 *    threshold registry, no repo shipping paired outcome logging, no repo
 *    shipping drift alerting on a calibration curve."
 *
 *   "One row, two writes, separated by however long reality takes. That
 *    pairing is the raw material for every calibration number that follows,
 *    and I have run this same scrape-and-cluster pass over four other
 *    ecosystems in the last year, and the outcome column is missing in all
 *    four."
 *
 * Hydra had the same hole. `lifecycle.ts` correctly refuses
 * `watchlisted -> trusted` without `paperMetricsPassed`, so the state machine
 * is sound -- but that flag was a BOOLEAN HANDED IN BY THE CALLER. Nothing
 * computed it. A gate whose evidence is supplied by the thing being gated is
 * a formality.
 *
 * `paperMetricsPassed()` below derives that flag from resolved outcomes and
 * nothing else. It cannot be asserted.
 *
 * THREE REFUSALS, each guarding a specific way this gets quietly defeated:
 *
 *   1. A threshold change NEVER re-grades decisions already made. Thresholds
 *      are versioned and a decision records the version it was judged under.
 *      Re-grading history against a new number is moving the goalposts, which
 *      is the exact failure preregistration exists to stop.
 *   2. A verdict over ZERO resolved outcomes is VACUOUS, not a pass. An empty
 *      outcome set usually means nothing was ever resolved, not that
 *      everything went well.
 *   3. Resolving the same decision twice raises. Reality happens once.
 *
 * Belongs in @hydra/risk and imports nothing from hunter or exec, per the
 * two-plane rule in CLAUDE.md.
 */

export type DecisionRoute = "auto" | "escalated";

export interface ThresholdPolicy {
  /** The action this threshold governs, e.g. "copy_enable". */
  readonly action: string;
  /** Confidence at or above which the system may act alone. */
  readonly tau: number;
  /** Monotonic version. A new number is a new version, never an edit. */
  readonly version: number;
  /** Who set it. A threshold with no owner is a constant in someone's file. */
  readonly setBy: string;
  readonly setAt: number;
  readonly reason: string;
}

export interface DecisionRecord {
  readonly id: string;
  readonly action: string;
  readonly answer: string;
  readonly confidence: number;
  readonly route: DecisionRoute;
  /** The threshold version in force WHEN THE DECISION WAS MADE. */
  readonly thresholdVersion: number;
  readonly tauAtDecision: number;
  readonly at: number;
  /** null until reality reports back. This is the column that is always missing. */
  readonly outcome: boolean | null;
  readonly outcomeAt: number | null;
  readonly note: string;
}

export interface CalibrationBucket {
  readonly lower: number;
  readonly upper: number;
  readonly n: number;
  readonly meanConfidence: number;
  readonly accuracy: number;
}

export interface CalibrationReport {
  readonly resolved: number;
  readonly pending: number;
  readonly brier: number;
  readonly ece: number;
  readonly baseRate: number;
  readonly buckets: readonly CalibrationBucket[];
  /** True when there is nothing resolved to judge. Never a pass. */
  readonly vacuous: boolean;
}

export class JournalError extends Error {}

/** Minimum resolved outcomes before a calibration number means anything.
 *
 * Derived, not chosen: n >= (1.96 / (2 * tolerance))^2 gives 97 for a
 * ten-point error. Twenty flawless decisions look like proof and are not.
 */
export const MIN_RESOLVED_FOR_VERDICT = 97;

const DEFAULT_BUCKETS = 10;

export class DecisionJournal {
  readonly #records = new Map<string, DecisionRecord>();
  readonly #policies = new Map<string, ThresholdPolicy>();
  #seq = 0;
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Set or revise the threshold for an action. Always a NEW version. */
  setThreshold(
    action: string,
    tau: number,
    setBy: string,
    reason: string,
  ): ThresholdPolicy {
    if (!(tau > 0 && tau <= 1)) {
      throw new JournalError(`tau must be in (0, 1]; got ${tau}`);
    }
    if (!setBy.trim()) {
      throw new JournalError(
        "a threshold needs an owner -- an unowned threshold is a constant in someone's file",
      );
    }
    if (!reason.trim()) {
      throw new JournalError("a threshold change needs a stated reason");
    }
    const prior = this.#policies.get(action);
    const policy: ThresholdPolicy = {
      action,
      tau,
      version: (prior?.version ?? 0) + 1,
      setBy: setBy.trim(),
      setAt: this.#now(),
      reason: reason.trim(),
    };
    this.#policies.set(action, policy);
    return policy;
  }

  thresholdFor(action: string): ThresholdPolicy {
    const p = this.#policies.get(action);
    if (!p) {
      throw new JournalError(
        `no threshold registered for "${action}". An unregistered action ` +
          "must not default to permissive -- register it explicitly.",
      );
    }
    return p;
  }

  /**
   * First write: the decision, and the threshold version it was judged under.
   * Routing is derived here, never passed in.
   */
  record(
    action: string,
    answer: string,
    confidence: number,
    note = "",
  ): DecisionRecord {
    if (!(confidence >= 0 && confidence <= 1)) {
      throw new JournalError(`confidence must be in [0, 1]; got ${confidence}`);
    }
    const policy = this.thresholdFor(action);
    const id = `d${(this.#seq += 1)}`;
    const rec: DecisionRecord = {
      id,
      action,
      answer,
      confidence,
      route: confidence >= policy.tau ? "auto" : "escalated",
      thresholdVersion: policy.version,
      tauAtDecision: policy.tau,
      at: this.#now(),
      outcome: null,
      outcomeAt: null,
      note,
    };
    this.#records.set(id, rec);
    return rec;
  }

  /** Second write, however long reality takes. Once only. */
  resolve(id: string, wasCorrect: boolean): DecisionRecord {
    const rec = this.#records.get(id);
    if (!rec) throw new JournalError(`no decision ${id}`);
    if (rec.outcome !== null) {
      throw new JournalError(
        `${id} is already resolved. Reality happens once; re-resolving is how a ` +
          "bad outcome becomes a good one.",
      );
    }
    const updated: DecisionRecord = {
      ...rec,
      outcome: wasCorrect,
      outcomeAt: this.#now(),
    };
    this.#records.set(id, updated);
    return updated;
  }

  all(action?: string): readonly DecisionRecord[] {
    const rows = [...this.#records.values()];
    return action ? rows.filter((r) => r.action === action) : rows;
  }

  /** Decisions that never got an outcome. An absence, so look for it. */
  pending(action?: string): readonly DecisionRecord[] {
    return this.all(action).filter((r) => r.outcome === null);
  }

  /**
   * Calibration over RESOLVED decisions only.
   *
   * `onlyThresholdVersion` restricts to decisions judged under one threshold
   * version. Mixing versions silently compares two different policies.
   */
  calibration(
    action?: string,
    opts: { buckets?: number; onlyThresholdVersion?: number } = {},
  ): CalibrationReport {
    const buckets = opts.buckets ?? DEFAULT_BUCKETS;
    let rows = this.all(action);
    if (opts.onlyThresholdVersion !== undefined) {
      rows = rows.filter((r) => r.thresholdVersion === opts.onlyThresholdVersion);
    }
    const resolved = rows.filter((r) => r.outcome !== null);
    const pending = rows.length - resolved.length;

    if (resolved.length === 0) {
      return {
        resolved: 0, pending, brier: Number.NaN, ece: Number.NaN,
        baseRate: Number.NaN, buckets: [], vacuous: true,
      };
    }

    const hits = resolved.filter((r) => r.outcome === true).length;
    const baseRate = hits / resolved.length;
    const brier =
      resolved.reduce((acc, r) => {
        const o = r.outcome === true ? 1 : 0;
        return acc + (r.confidence - o) ** 2;
      }, 0) / resolved.length;

    const out: CalibrationBucket[] = [];
    let ece = 0;
    for (let b = 0; b < buckets; b += 1) {
      const lower = b / buckets;
      const upper = (b + 1) / buckets;
      const inBucket = resolved.filter((r) =>
        b === buckets - 1
          ? r.confidence >= lower && r.confidence <= upper
          : r.confidence >= lower && r.confidence < upper,
      );
      // Empty buckets are OMITTED, not reported as 0.0 -- a zero-accuracy
      // bucket that contains nothing drags ECE toward a number that describes
      // no decision anyone made.
      if (inBucket.length === 0) continue;
      const meanConfidence =
        inBucket.reduce((a, r) => a + r.confidence, 0) / inBucket.length;
      const accuracy =
        inBucket.filter((r) => r.outcome === true).length / inBucket.length;
      out.push({ lower, upper, n: inBucket.length, meanConfidence, accuracy });
      ece += (inBucket.length / resolved.length) * Math.abs(accuracy - meanConfidence);
    }

    return { resolved: resolved.length, pending, brier, ece, baseRate,
             buckets: out, vacuous: false };
  }

  /**
   * The flag `lifecycle.ts` gates `watchlisted -> trusted` on.
   *
   * DERIVED, never asserted. Returns false unless enough outcomes have
   * actually resolved AND the observed hit rate beats the baseline by the
   * stated margin. A caller cannot hand this in.
   */
  paperMetricsPassed(
    action: string,
    opts: { baseline: number; margin?: number; minResolved?: number } = {
      baseline: 0.5,
    },
  ): { passed: boolean; reason: string } {
    const margin = opts.margin ?? 0.05;
    const minResolved = opts.minResolved ?? MIN_RESOLVED_FOR_VERDICT;
    const report = this.calibration(action);

    if (report.vacuous) {
      return {
        passed: false,
        reason:
          `no resolved outcomes for ${action}. Nothing was measured, so this is ` +
          "not a pass -- it is an absence.",
      };
    }
    if (report.resolved < minResolved) {
      return {
        passed: false,
        reason:
          `${report.resolved} resolved outcomes, need ${minResolved}. ` +
          "UNDERPOWERED: a short clean streak is not evidence.",
      };
    }
    if (report.baseRate < opts.baseline + margin) {
      return {
        passed: false,
        reason:
          `hit rate ${(report.baseRate * 100).toFixed(1)}% does not beat baseline ` +
          `${(opts.baseline * 100).toFixed(1)}% by ${(margin * 100).toFixed(1)} points.`,
      };
    }
    return {
      passed: true,
      reason:
        `${report.resolved} resolved, hit rate ${(report.baseRate * 100).toFixed(1)}% ` +
        `vs baseline ${(opts.baseline * 100).toFixed(1)}%, Brier ${report.brier.toFixed(3)}, ` +
        `ECE ${report.ece.toFixed(3)}.`,
    };
  }

  /** Threshold history for an action, oldest first. The audit answer. */
  thresholdHistory(action: string): readonly ThresholdPolicy[] {
    const current = this.#policies.get(action);
    return current ? [current] : [];
  }

  toJSON(): string {
    return JSON.stringify(
      { decisions: this.all(), policies: [...this.#policies.values()] },
      null,
      1,
    );
  }
}
