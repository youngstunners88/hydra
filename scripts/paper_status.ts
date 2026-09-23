/**
 * Report the paper run: how long it has been going, and what is still missing.
 *
 * Read-only. It records nothing, resolves nothing and touches no venue. Run it
 * as often as you like.
 *
 *   node --experimental-strip-types scripts/paper_status.ts [path] [--days N]
 *
 * The clock is DERIVED from the oldest journalled decision, not from a
 * start-date field. A hand-written start date asserts that a run happened; the
 * timestamp of the earliest decision is evidence that one did.
 */
import { FileSink, PersistentJournal, paperRunStatus } from "../packages/risk/src/journalStore.ts";
import { numberFlag, parseArgs } from "../packages/risk/src/cliArgs.ts";
import { MIN_RESOLVED_FOR_VERDICT } from "../packages/risk/src/journal.ts";
import { PROMOTION_ACTION } from "../packages/decide/src/promotion.ts";

const DEFAULT_LOG = "ops/journal/decisions.jsonl";

function main(argv: string[]): number {
  let path: string;
  let requiredDays: number;
  try {
    const parsed = parseArgs(argv, { withValue: ["days"] });
    path = parsed.positional[0] ?? DEFAULT_LOG;
    // 2 days: the user's explicit decision on 2026-09-23, matching
    // tradecc's MINIMUM_PAPER_TRADING_DAYS. The 97-resolved check is unchanged.
    requiredDays = numberFlag(parsed, "days", 2);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  if (requiredDays <= 0) {
    console.error(`--days must be positive; got ${requiredDays}`);
    return 2;
  }

  const journal = PersistentJournal.open(new FileSink(path)).journal;
  const s = paperRunStatus(journal, requiredDays, Date.now(), PROMOTION_ACTION);

  console.log(`log            ${path}`);
  if (s.decisions === 0) {
    console.log("status         NOT STARTED -- no decisions journalled yet.");
    console.log("               The clock is the age of the oldest decision, so it");
    console.log("               starts when the hunter first calls promote().");
    return 1;
  }

  const report = journal.calibration(PROMOTION_ACTION);
  console.log(`started        ${new Date(s.startedAt).toISOString()}`);
  console.log(`elapsed        ${s.elapsedDays.toFixed(2)} of ${s.requiredDays} days`);
  console.log(`decisions      ${s.decisions} recorded, ${s.resolved} resolved, ${s.decisions - s.resolved} pending`);
  if (!report.vacuous) {
    console.log(`calibration    Brier ${report.brier.toFixed(3)}  ECE ${report.ece.toFixed(3)}  base rate ${(report.baseRate * 100).toFixed(1)}%`);
  }

  // Both conditions, reported separately. They fail for different reasons and
  // a single "not ready" hides which one is actually blocking.
  const blockers: string[] = [];
  if (!s.satisfied) blockers.push(`${s.daysRemaining.toFixed(2)} more days of elapsed time`);
  if (s.resolved < MIN_RESOLVED_FOR_VERDICT) {
    blockers.push(`${MIN_RESOLVED_FOR_VERDICT - s.resolved} more RESOLVED outcomes`);
  }
  if (blockers.length === 0) {
    console.log("status         paper-run duration and sample size both satisfied.");
    console.log("               This is NOT a live-trading approval. The gate has");
    console.log("               other checks and a human one.");
    return 0;
  }
  console.log(`status         BLOCKED -- needs ${blockers.join(" and ")}.`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
