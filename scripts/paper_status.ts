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
    // Same precedence as hunt and resolve: explicit path, then HYDRA_JOURNAL,
    // then the default. It ignored HYDRA_JOURNAL until 2026-09-23, so a run
    // pointed at a scratch journal reported on the REAL one.
    path = parsed.positional[0] ?? process.env.HYDRA_JOURNAL ?? DEFAULT_LOG;
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
  // The clock spans every promotion action: the paper run is one run, whichever
  // arm recorded a decision first.
  const s = paperRunStatus(journal, requiredDays, Date.now());

  console.log(`log            ${path}`);
  if (s.decisions === 0) {
    console.log("status         NOT STARTED -- no decisions journalled yet.");
    console.log("               The clock is the age of the oldest decision, so it");
    console.log("               starts when the hunter first calls promote().");
    return 1;
  }

  // Calibration is reported PER ACTION and never pooled: the arms' confidences
  // are on different scales (see decide/src/jev/types.ts).
  const actions = [...new Set(journal.all().map((r) => r.action))]
    .filter((a) => a === PROMOTION_ACTION || a.startsWith(`${PROMOTION_ACTION}@`)).sort();
  for (const a of actions) {
    const c = journal.calibration(a);
    const n = journal.all(a).length;
    console.log(`  ${a.padEnd(30)} ${String(n).padStart(4)} decided  ${String(c.resolved).padStart(4)} resolved` +
      (c.vacuous ? "" : `  Brier ${c.brier.toFixed(3)}  base rate ${(c.baseRate * 100).toFixed(1)}%`));
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
  // The 97 must hold WITHIN one action. The experiment records up to three
  // arms per wallet, so a total across actions would reach 97 after ~33
  // wallets -- three correlated outcomes counted as three independent ones.
  const bestResolved = Math.max(0, ...actions.map((a) => journal.calibration(a).resolved));
  if (bestResolved < MIN_RESOLVED_FOR_VERDICT) {
    blockers.push(`${MIN_RESOLVED_FOR_VERDICT - bestResolved} more RESOLVED outcomes in a single action`);
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
