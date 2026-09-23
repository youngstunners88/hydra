/**
 * Resolve matured promotion decisions under the sealed rule.
 *
 *   pnpm resolve              # resolve everything that has matured
 *   pnpm resolve -- --dry-run # judge and print, write nothing
 *
 * Refuses to run unless the rule in code matches ops/journal/resolution-rule.json.
 * Immature and unreadable decisions are left pending, never marked wrong.
 * Hunt plane: three JSON-RPC reads behind a PlaneGuard; no key, no signer.
 */
import { readFileSync } from "node:fs";
import { FileSink, PersistentJournal } from "../packages/risk/src/journalStore.ts";
import { parseArgs } from "../packages/risk/src/cliArgs.ts";
import { PROMOTION_ACTION } from "../packages/hunter/src/promotion.ts";
import { httpJsonRpc } from "../packages/hunter/src/sources/rpcHunter.ts";
import { assertSealed } from "../packages/hunter/src/resolve/rule.ts";
import { RpcChainReader } from "../packages/hunter/src/resolve/chainReader.ts";
import { resolvePending } from "../packages/hunter/src/resolve/resolver.ts";
import type { ResolvingJournal } from "../packages/hunter/src/resolve/resolver.ts";

const LOG = process.env.HYDRA_JOURNAL ?? "ops/journal/decisions.jsonl";
const RULE = "ops/journal/resolution-rule.json";
const ENDPOINT = process.env.PULSECHAIN_RPC ?? "https://rpc.pulsechain.com";

async function main(argv: string[]): Promise<number> {
  const dryRun = parseArgs(argv, { withValue: [], boolean: ["dry-run"] }).booleans.has("dry-run");

  await assertSealed(JSON.parse(readFileSync(RULE, "utf8")));

  const persistent = PersistentJournal.open(new FileSink(LOG));
  // --dry-run judges against the real chain but swaps in a journal whose
  // resolve() records nothing. Same code path, no write.
  const journal: ResolvingJournal = dryRun
    ? { pending: (a) => persistent.pending(a), resolve: () => undefined }
    : persistent;

  const report = await resolvePending(
    journal, new RpcChainReader(httpJsonRpc(ENDPOINT)), PROMOTION_ACTION,
  );

  console.log(`rule        ${report.rule}`);
  console.log(`resolved    ${report.resolved}${dryRun ? " (dry run: not written)" : ""}`);
  console.log(`immature    ${report.immature}`);
  console.log(`unreadable  ${report.unreadable}`);
  for (const f of report.fates) {
    if (f.kind === "resolved") {
      console.log(`  ${f.id} ${f.wallet.slice(0, 10)}… ${f.correct ? "CORRECT" : "WRONG  "} ${f.before} -> ${f.after} wei`);
    } else if (f.kind === "unreadable") {
      console.log(`  ${f.id} UNREADABLE: ${f.reason}`);
    }
  }
  const next = report.fates
    .filter((f) => f.kind === "immature")
    .map((f) => (f as { maturesAt: number }).maturesAt)
    .sort((a, b) => a - b)[0];
  if (next !== undefined) console.log(`next matures ${new Date(next).toISOString()}`);
  // Unreadable is reported, not fatal: one bad RPC read must not block the
  // rest, and the decision stays pending for the next run.
  return 0;
}

main(process.argv.slice(2)).then((c) => process.exit(c));
