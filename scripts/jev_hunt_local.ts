/**
 * The Jev arms of experiment permutation-brier-v1, run LOCALLY.
 *
 *   pnpm jev:local
 *
 * No model key lives on GitHub (user decision, 2026-09-23), so the hourly
 * paper-run stays heuristic-only and this script runs wherever the key
 * already is: this Claude Code environment, a laptop, a VPS. It:
 *
 *   1. refuses to start without OPENROUTER_API_KEY in the environment
 *   2. resolves, then hunts, against a SEPARATE journal,
 *      ops/journal/jev-local.jsonl -- the CI journal is never touched, so the
 *      two writers can never collide
 *   3. records all three arms for every fresh wallet, so this journal is
 *      self-contained: its own clock, its own pairs, its own 97
 *
 * It never pushes. Committing jev-local.jsonl is a deliberate act by whoever
 * ran it.
 */
import { spawnSync } from "node:child_process";

const JOURNAL = process.env.JEV_LOCAL_JOURNAL ?? "ops/journal/jev-local.jsonl";

if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set on this machine. Jev arms run locally only; refusing.");
  process.exit(2);
}

const env = { ...process.env, HYDRA_JOURNAL: JOURNAL };
const run = (script: string, args: string[]) => {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", script, ...args],
    { stdio: "inherit", env });
  return r.status ?? 1;
};

console.log(`journal    ${JOURNAL}`);
const resolved = run("scripts/resolve_outcomes.ts", []);
if (resolved !== 0) process.exit(resolved);
const hunted = run("scripts/hunt_once.ts", ["--jev", ...process.argv.slice(2)]);
if (hunted !== 0) process.exit(hunted);
process.exit(run("scripts/experiment.ts", []));
