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
import { ARM_ACTIONS } from "../packages/decide/src/experiment/retentionArms.ts";
import { pairedBrier } from "../packages/decide/src/experiment/pairedBrier.ts";

const LOG = process.env.HYDRA_JOURNAL ?? "ops/journal/decisions.jsonl";
const SEAL = "ops/experiments/permutation-brier-v1.json";

const sealed = JSON.parse(readFileSync(SEAL, "utf8")) as { sha256: string; text: string };
if (createHash("sha256").update(sealed.text).digest("hex") !== sealed.sha256) {
  console.error("experiment text no longer matches its seal; refusing to grade");
  process.exit(2);
}

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
process.exit(0);
