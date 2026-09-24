/**
 * Grade permutation-brier-v1 from the journal, exactly as sealed.
 *
 *   pnpm experiment
 *
 * Refuses unless ops/experiments/permutation-brier-v1.json still hashes to
 * its seal. Read-only: it writes nothing.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { FileSink, PersistentJournal } from "../packages/risk/src/journalStore.ts";
import { ARM_ACTIONS, V2_ACTIONS } from "../packages/decide/src/experiment/retentionArms.ts";
import { pairedBrier, tripleBrier } from "../packages/decide/src/experiment/pairedBrier.ts";

const LOG = process.env.HYDRA_JOURNAL ?? "ops/journal/decisions.jsonl";
const SEAL = "ops/experiments/permutation-brier-v1.json";
const SEAL_V2 = "ops/experiments/noul-retention-v2.json";

const load = (path: string) => {
  const s = JSON.parse(readFileSync(path, "utf8")) as { sha256: string; text: string };
  if (createHash("sha256").update(s.text).digest("hex") !== s.sha256) {
    console.error(`${path}: text no longer matches its seal; refusing to grade`);
    process.exit(2);
  }
  return s;
};
const sealed = load(SEAL);
const sealedV2 = load(SEAL_V2);

const j = PersistentJournal.open(new FileSink(LOG));
const rows = (a: string) => j.all(a).map((r) => ({ answer: r.answer, confidence: r.confidence, outcome: r.outcome }));
const r = pairedBrier(rows(ARM_ACTIONS.single), rows(ARM_ACTIONS.permuted));

console.log(`experiment   permutation-brier-v1 (seal ${sealed.sha256.slice(0, 16)})`);
console.log(`pairs        ${r.pairs} resolved in both arms (minimum ${r.minimum})`);
if (r.pairs > 0) {
  console.log(`Brier        single ${r.brierA.toFixed(4)}   permuted ${r.brierB.toFixed(4)}`);
  console.log(`improvement  ${r.improvement.toFixed(4)} (sealed threshold ${r.threshold})`);
}
console.log(`verdict      ${r.verdict}`);

const t = tripleBrier(rows(V2_ACTIONS.noul), rows(ARM_ACTIONS.permuted), rows(V2_ACTIONS.constant));
console.log(`experiment   noul-retention-v2 (seal ${sealedV2.sha256.slice(0, 16)})`);
console.log(`pairs        ${t.pairs} resolved in all three arms (minimum ${t.minimum})`);
if (t.pairs > 0) {
  console.log(`Brier        noul ${t.noul.toFixed(4)}   permuted ${t.permuted.toFixed(4)}   constant ${t.constant.toFixed(4)}`);
}
console.log(`verdict      ${t.verdict}`);
process.exit(0);
