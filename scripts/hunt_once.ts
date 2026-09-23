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
import {
  ARM_ACTIONS, confidenceFromValue, features, jevForecasts,
} from "../packages/decide/src/experiment/retentionArms.ts";
import { JevHttpEngine } from "../packages/decide/src/jev/adapters/jevHttp.ts";
import { RpcHunter, httpJsonRpc } from "../packages/hunter/src/sources/rpcHunter.ts";
import { RpcChainReader } from "../packages/hunter/src/sources/rpcChainReader.ts";
import { numberFlag, parseArgs } from "../packages/risk/src/cliArgs.ts";
import type { Observation } from "../packages/core/src/index.ts";

const DEFAULT_LOG = "ops/journal/decisions.jsonl";
const ENDPOINT = process.env.PULSECHAIN_RPC ?? "https://rpc.pulsechain.com";

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    withValue: ["blocks", "min-value"],
    boolean: ["dry-run", "jev"],
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
  // Thresholds are registered once per action. Re-setting one every run would
  // create a new version per run and split calibration into single-decision
  // cohorts.
  for (const action of Object.values(ARM_ACTIONS)) {
    try {
      journal.thresholdFor(action);
    } catch {
      journal.setThreshold(action, 0.7, "hunt_once.ts",
        "paper-run threshold for permutation-brier-v1; not validated against outcomes");
      console.log(`threshold  registered tau=0.7 for ${action}`);
    }
  }

  // ONE DECISION PER WALLET, EVER, across every wallet_promotion action --
  // including the legacy un-suffixed one. A whale seen hourly would otherwise
  // be twenty correlated samples, and n = 97 assumes independent ones.
  const seen = new Set(
    journal.all()
      .filter((r) => r.action === PROMOTION_ACTION || r.action.startsWith(`${PROMOTION_ACTION}@`))
      .map((r) => r.answer.split(":")[0]),
  );
  const fresh = observations.filter((o) => !seen.has(o.address));
  if (fresh.length < observations.length) {
    console.log(`skipped    ${observations.length - fresh.length} wallet(s) already journalled`);
  }

  // Jev arms are OPT-IN (--jev), never inferred from a key being present:
  // GitHub Actions must stay heuristic-only (no model key on GitHub, user
  // decision 2026-09-23), and a key that happens to be in some environment
  // must not silently change what a run records. `pnpm jev:local` passes
  // --jev and points at a separate journal.
  const wantJev = parsed.booleans.has("jev");
  if (wantJev && !process.env.OPENROUTER_API_KEY) {
    console.error("--jev needs OPENROUTER_API_KEY in this machine's environment; refusing");
    return 2;
  }
  const jev = wantJev ? new JevHttpEngine({ getKey: () => process.env.OPENROUTER_API_KEY }) : null;
  if (!jev) console.log("jev        off (heuristic arm only)");
  const reader = new RpcChainReader(httpJsonRpc(ENDPOINT));
  const head = jev ? await reader.head() : null;

  const gates = (address: string) => ({
    hasValidAddress: /^0x[0-9a-f]{40}$/.test(address),
    hasAtLeastOneSource: true,
    hasProfileAndSecurityFeatures: false,
    meetsWatchMinScore: false,
    isNotSybil: false,
    isConfirmedByHumanOrAutoPromote: false,
  });

  let recorded = 0;
  let jevPairs = 0;
  let jevFailures = 0;
  for (const o of fresh) {
    const native = (o.raw as { nativeValue: number }).nativeValue;
    const note = `${o.source} ${native} PLS @ ${o.observedAt}`;
    const record = (action: string, confidence: number) => {
      promote(journal, { walletId: o.address, from: "watchlisted", to: "trusted",
        confidence, gates: gates(o.address), note }, { baseline: 0.5 }, action);
      recorded += 1;
    };

    // Jev FIRST, so the pair is only recorded if both halves exist. A failed
    // call records neither Jev arm -- never a single without its twin.
    let pair: { single: number; permuted: number } | null = null;
    if (jev && head) {
      try {
        const balance = Number((await reader.balanceAt(o.address, head.number)) / 10n ** 12n) / 1e6;
        pair = await jevForecasts(jev, features(native, balance));
      } catch (e) {
        jevFailures += 1;
        console.log(`  ${o.address}  jev skipped: ${(e as Error).message}`);
      }
    }
    record(ARM_ACTIONS.heuristic, confidenceFromValue(native, minValue));
    if (pair) {
      record(ARM_ACTIONS.single, pair.single);
      record(ARM_ACTIONS.permuted, pair.permuted);
      jevPairs += 1;
      if (jevPairs <= 3) {
        console.log(`  ${o.address}  single ${pair.single.toFixed(3)}  permuted ${pair.permuted.toFixed(3)}`);
      }
    }
  }
  if (jev) console.log(`jev        ${jevPairs} paired forecast(s), ${jevFailures} failure(s)`);

  console.log(`journalled ${recorded} decision(s) -> ${logPath}`);
  console.log("Run `pnpm paper:status` to see the clock.");
  console.log("NOTE: promotions are refused until the journal has resolved");
  console.log("      outcomes. That is the gate working, not a failure.");
  return 0;
}

main(process.argv.slice(2)).then((c) => process.exit(c));
