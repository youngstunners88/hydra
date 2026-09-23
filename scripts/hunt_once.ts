/**
 * One hunt pass: observe real wallets, journal a decision about each.
 *
 * This is the file whose absence kept the paper clock at zero. `package.json`
 * has advertised `pnpm hunt` since the repo was created and the script it
 * pointed at did not exist, so nothing ever called `promote()`, so the journal
 * stayed empty, so the clock -- which is the age of the oldest journalled
 * decision -- never started.
 *
 *   pnpm hunt                    # real PulseChain reads, writes the journal
 *   pnpm hunt -- --dry-run       # observe and print, journal nothing
 *   pnpm hunt -- --blocks 5 --min-value 50000
 *
 * HUNT PLANE ONLY. Two JSON-RPC read methods, both behind a PlaneGuard built
 * from a closed allowlist. No key is read, no signer is constructed, no venue
 * is contacted. `AGENT_WALLET_ENABLED` is not consulted because nothing here
 * could act on it.
 *
 * WHAT A "DECISION" MEANS HERE
 *
 * For each observed wallet it asks: should this be promoted from watchlisted
 * to trusted? The answer will be NO for a long time, because
 * `paperMetricsPassed` is derived from resolved outcomes and there are none
 * yet. That is the intended behaviour, not a failure: a refused promotion is
 * still a recorded prediction, and it is the raw material the calibration is
 * built from. The clock starts on the first of them either way.
 *
 * CONFIDENCE IS NOT A SCORE YET
 *
 * The confidence attached to each decision is a crude transform of transfer
 * size. It is deliberately simple and deliberately disclosed: the journal
 * exists to find out whether a confidence number is worth anything, and
 * seeding it with an elaborate unvalidated score would only make the first
 * calibration report harder to interpret. Replace it once there are 97
 * resolved outcomes to judge a replacement against.
 */

import { PersistentJournal, FileSink } from "../packages/risk/src/journalStore.ts";
import { promote, PROMOTION_ACTION } from "../packages/decide/src/promotion.ts";
import { RpcHunter, httpJsonRpc } from "../packages/hunter/src/sources/rpcHunter.ts";
import { numberFlag, parseArgs } from "../packages/risk/src/cliArgs.ts";
import type { Observation } from "../packages/core/src/index.ts";

const DEFAULT_LOG = "ops/journal/decisions.jsonl";
const ENDPOINT = process.env.PULSECHAIN_RPC ?? "https://rpc.pulsechain.com";

/** Transfer size -> confidence, clamped. Crude on purpose; see the header. */
export function confidenceFromValue(native: number, floor: number): number {
  if (!(native > 0) || !(floor > 0)) return 0.5;
  const ratio = native / floor;
  // log10 so a 10x transfer moves confidence by one step, not 10.
  const raw = 0.5 + Math.log10(ratio) * 0.1;
  return Math.min(0.95, Math.max(0.05, Number(raw.toFixed(4))));
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    withValue: ["blocks", "min-value"],
    boolean: ["dry-run"],
  });
  const dryRun = parsed.booleans.has("dry-run");
  const blocks = numberFlag(parsed, "blocks", 3);
  const minValue = numberFlag(parsed, "min-value", 10_000);
  const logPath = process.env.HYDRA_JOURNAL ?? DEFAULT_LOG;

  const hunter = new RpcHunter({
    chain: "369",
    endpoint: ENDPOINT,
    blocks,
    minNativeValue: minValue,
    fetchJson: httpJsonRpc(ENDPOINT),
  });

  console.log(`hunter     ${hunter.id}`);
  console.log(`endpoint   ${ENDPOINT}`);
  console.log(`scanning   ${blocks} block(s), transfers >= ${minValue.toLocaleString()} PLS`);

  let observations: Observation[];
  try {
    observations = await hunter.discover();
  } catch (e) {
    console.error(`hunt failed: ${(e as Error).message}`);
    return 1;
  }
  console.log(`observed   ${observations.length} distinct wallet(s)`);

  if (observations.length === 0) {
    // Not an error, and deliberately not journalled. A run that saw nothing is
    // not a prediction about anything, and recording an empty pass would age
    // the clock without adding evidence.
    console.log("nothing above the floor this pass. Journal untouched.");
    return 0;
  }

  if (dryRun) {
    for (const o of observations) {
      const v = (o.raw as { nativeValue: number }).nativeValue;
      console.log(`  ${o.address}  ${v.toLocaleString()} PLS  block ${(o.raw as { blockNumber: string }).blockNumber}`);
    }
    console.log("--dry-run: journal untouched.");
    return 0;
  }

  const journal = PersistentJournal.open(new FileSink(logPath));
  // Registering a threshold is idempotent in effect but versioned in the log,
  // so it is only set when the action has none. Re-setting it every run would
  // produce a new version per run and split the calibration into useless
  // single-decision cohorts.
  try {
    journal.thresholdFor(PROMOTION_ACTION);
  } catch {
    journal.setThreshold(
      PROMOTION_ACTION, 0.7, "hunt_once.ts",
      "initial paper-run threshold; not yet validated against any outcome",
    );
    console.log(`threshold  registered tau=0.7 for ${PROMOTION_ACTION}`);
  }

  // ONE DECISION PER WALLET, EVER. A whale seen every hour would otherwise
  // become twenty correlated samples of the same prediction, and the 97-outcome
  // minimum is derived assuming independent ones -- n would be inflated and
  // the confidence interval would be a fiction.
  const seen = new Set(
    journal.all(PROMOTION_ACTION).map((r) => r.answer.split(":")[0]),
  );
  const fresh = observations.filter((o) => !seen.has(o.address));
  if (fresh.length < observations.length) {
    console.log(`skipped    ${observations.length - fresh.length} wallet(s) already journalled`);
  }

  let recorded = 0;
  for (const o of fresh) {
    const native = (o.raw as { nativeValue: number }).nativeValue;
    const out = promote(
      journal,
      {
        walletId: o.address,
        from: "watchlisted",
        to: "trusted",
        confidence: confidenceFromValue(native, minValue),
        gates: {
          hasValidAddress: /^0x[0-9a-f]{40}$/.test(o.address),
          hasAtLeastOneSource: true,
          hasProfileAndSecurityFeatures: false,
          meetsWatchMinScore: false,
          isNotSybil: false,
          isConfirmedByHumanOrAutoPromote: false,
        },
        note: `${o.source} ${native} PLS @ ${o.observedAt}`,
      },
      { baseline: 0.5 },
    );
    recorded += 1;
    if (recorded <= 3) {
      console.log(`  ${o.address}  ${out.decisionId}  allowed=${out.allowed}`);
    }
  }

  console.log(`journalled ${recorded} decision(s) -> ${logPath}`);
  console.log("Run `pnpm paper:status` to see the clock.");
  console.log("NOTE: promotions are refused until the journal has resolved");
  console.log("      outcomes. That is the gate working, not a failure.");
  return 0;
}

main(process.argv.slice(2)).then((c) => process.exit(c));
