/**
 * Coverage reconciliation: find the position that nothing is protecting.
 *
 * From Senpi's DSL docs, and it is the single most transferable sentence in
 * that repository:
 *
 *   "An open position that is MISSING from that list is UNPROTECTED. That is
 *    the whole trap: an unprotected position shows up as an absence, not a
 *    warning, so you have to look for what's not there."
 *
 * Every monitor reports the rows it has. Nothing reports the rows it should
 * have had. So the only check that works is a DIFF between an authoritative
 * list of open positions and the list of positions a stop is actually tracking.
 *
 * `vacuous` matters as much as `uncovered`. A reconciliation over an empty
 * expected set passes trivially, and a trivial pass is the most dangerous
 * output this module can produce -- an empty expected set usually means the
 * query that built it broke, not that there is nothing left to protect.
 */

export interface Coverage<T> {
  /** Expected but absent from the protected set. THE failure. */
  readonly uncovered: readonly string[];
  /** Present but failing the health predicate, e.g. tracked with no floor. */
  readonly degraded: readonly string[];
  /** Protected but nothing expects it. Worth knowing, not a safety gap. */
  readonly orphaned: readonly string[];
  readonly healthy: readonly string[];
  /** Nothing was expected, so a pass proves nothing. */
  readonly vacuous: boolean;
  readonly notes: Readonly<Record<string, string>>;
}

export interface ReconcileOptions<E, A> {
  keyOfExpected: (item: E) => string;
  keyOfActual: (item: A) => string;
  /** Optional per-item health check over the ACTUAL record. */
  healthy?: (item: A) => boolean;
  whyUnhealthy?: (item: A) => string;
}

export function reconcile<E, A>(
  expected: readonly E[],
  actual: readonly A[],
  opts: ReconcileOptions<E, A>,
): Coverage<E> {
  const exp = new Map<string, E>();
  for (const e of expected) exp.set(opts.keyOfExpected(e), e);
  const act = new Map<string, A>();
  for (const a of actual) act.set(opts.keyOfActual(a), a);

  const uncovered: string[] = [];
  const orphaned: string[] = [];
  const degraded: string[] = [];
  const healthy: string[] = [];
  const notes: Record<string, string> = {};

  for (const k of exp.keys()) if (!act.has(k)) uncovered.push(k);
  for (const k of act.keys()) if (!exp.has(k)) orphaned.push(k);
  for (const k of exp.keys()) {
    const a = act.get(k);
    if (a === undefined) continue;
    if (opts.healthy && !opts.healthy(a)) {
      degraded.push(k);
      if (opts.whyUnhealthy) notes[k] = opts.whyUnhealthy(a);
    } else {
      healthy.push(k);
    }
  }

  return Object.freeze({
    uncovered: uncovered.sort(),
    degraded: degraded.sort(),
    orphaned: orphaned.sort(),
    healthy: healthy.sort(),
    vacuous: exp.size === 0,
    notes: Object.freeze(notes),
  });
}

/**
 * True only on a pass that actually checked something.
 *
 * `vacuous` forces false deliberately -- see the module docstring.
 */
export function isCovered<T>(c: Coverage<T>): boolean {
  return !c.vacuous && c.uncovered.length === 0 && c.degraded.length === 0;
}

export function summarize<T>(c: Coverage<T>): string {
  if (c.vacuous) {
    return (
      "VACUOUS: nothing was expected, so this check proves nothing. " +
      "Verify the source of the expected set before trusting a pass."
    );
  }
  if (isCovered(c)) return `OK: ${c.healthy.length} protected, nothing missing.`;
  const parts: string[] = [];
  if (c.uncovered.length) parts.push(`UNPROTECTED (${c.uncovered.length}): ${c.uncovered.join(", ")}`);
  if (c.degraded.length) parts.push(`DEGRADED (${c.degraded.length}): ${c.degraded.join(", ")}`);
  if (c.orphaned.length) parts.push(`orphaned (${c.orphaned.length}): ${c.orphaned.join(", ")}`);
  return parts.join(" | ");
}
