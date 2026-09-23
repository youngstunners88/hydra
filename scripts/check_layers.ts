/**
 * Enforce the package dependency rule (SPEC.md section 8) from ops/layers.json.
 *
 * SPEC section 8 has stated the rule as a table since the repo was created:
 * hunter may import "core, intel ports, storage"; exec "core, risk, tokens,
 * storage"; and so on. Nothing ever checked it. A rule that is only prose is
 * obeyed until the first deadline, and nobody notices the day it stops being.
 *
 * Deny by default. An import from package A to package B is legal only if B
 * appears in A's allow-list. A package missing from the file may import
 * nothing in-repo. Both `@hydra/x` specifiers and relative paths that climb
 * into another package's directory are caught -- the relative form is the
 * one that slips past review, because it does not look like a dependency.
 *
 *   node --experimental-strip-types scripts/check_layers.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export interface Violation {
  readonly file: string;
  readonly from: string;
  readonly to: string;
  readonly specifier: string;
}

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Which package does a resolved absolute path belong to, if any? */
function packageOf(root: string, abs: string): string | null {
  const rel = relative(join(root, "packages"), abs);
  if (rel.startsWith("..")) return null;
  return rel.split(sep)[0] ?? null;
}

export function importsOf(source: string): string[] {
  return [...source.matchAll(IMPORT)].map((m) => m[1] as string);
}

export function check(
  root: string,
  allow: Readonly<Record<string, readonly string[]>>,
): Violation[] {
  const violations: Violation[] = [];
  const pkgRoot = join(root, "packages");
  for (const pkg of readdirSync(pkgRoot)) {
    const src = join(pkgRoot, pkg, "src");
    let files: string[];
    try { files = walk(src); } catch { continue; }   // scaffold package, no src
    const allowed = new Set(allow[pkg] ?? []);
    for (const file of files) {
      for (const spec of importsOf(readFileSync(file, "utf8"))) {
        let target: string | null = null;
        const scoped = /^@hydra\/([^/]+)/.exec(spec);
        if (scoped) target = scoped[1] as string;
        else if (spec.startsWith(".")) target = packageOf(root, resolve(join(file, ".."), spec));
        if (target === null || target === pkg) continue;
        if (!allowed.has(target)) {
          violations.push({ file: relative(root, file), from: pkg, to: target, specifier: spec });
        }
      }
    }
  }
  return violations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  const rules = JSON.parse(readFileSync(join(root, "ops/layers.json"), "utf8")) as {
    allow: Record<string, string[]>;
  };
  const v = check(root, rules.allow);
  if (v.length === 0) {
    console.log("layers OK: every in-repo import is on ops/layers.json's allow-list.");
    process.exit(0);
  }
  console.log(`LAYER VIOLATIONS (${v.length}):`);
  for (const x of v) console.log(`  ${x.from} -> ${x.to}   ${x.file}   "${x.specifier}"`);
  process.exit(1);
}
