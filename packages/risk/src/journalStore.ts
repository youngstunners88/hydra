/**
 * Durable storage for the decision journal, and the paper clock it feeds.
 *
 * WHY THIS EXISTS
 *
 * `DecisionJournal` keeps everything in a `Map`. That is correct for the
 * calibration maths and useless for the thing the journal is actually for: the
 * live gate requires a MINIMUM PAPER RUN measured in days, and a run that
 * spans days spans process restarts. An in-memory journal starts the clock
 * over every time the hunter is redeployed, which would report a fresh
 * two-day run forever and never reach the threshold -- or worse, reach it
 * against decisions that were silently discarded.
 *
 * So the journal had to become durable before the paper clock could be
 * started at all. This is the file that does it.
 *
 * APPEND-ONLY, DELIBERATELY
 *
 * Events are appended as JSONL and never rewritten in place. A resolve is a
 * new line, not an edit of the line that recorded the decision. Three reasons,
 * all of them things that have already gone wrong somewhere in this workspace:
 *
 *   1. A rewritten file can lose everything to a crash mid-write. An append
 *      that fails leaves every prior line intact.
 *   2. An outcome that can be edited is an outcome that can be improved after
 *      the fact. The journal's own refusal #3 says reality happens once; an
 *      append-only log is what makes that true on disk rather than just in
 *      memory.
 *   3. The file IS the audit record. A log that only holds current state
 *      cannot answer "what did we believe on the day we decided".
 *
 * Replay reconstructs the journal by applying events in order. Unknown event
 * kinds RAISE rather than being skipped: a log written by a newer version and
 * read by an older one would otherwise silently drop decisions, and a journal
 * missing decisions still computes a confident-looking calibration number.
 */

import { DecisionJournal } from "./journal.ts";
import type { DecisionRecord, ThresholdPolicy } from "./journal.ts";

export type JournalEvent =
  | { kind: "threshold"; policy: ThresholdPolicy }
  | { kind: "decision"; record: DecisionRecord }
  | { kind: "outcome"; id: string; outcome: boolean; outcomeAt: number };

export class JournalStoreError extends Error {}

/** The append sink. A file in production; an array in tests. */
export interface AppendSink {
  append(line: string): void;
  readAll(): readonly string[];
}

export class MemorySink implements AppendSink {
  readonly lines: string[] = [];
  append(line: string): void {
    this.lines.push(line);
  }
  readAll(): readonly string[] {
    return [...this.lines];
  }
}

export function encode(event: JournalEvent): string {
  return JSON.stringify(event);
}

export function decode(line: string): JournalEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new JournalStoreError(`journal log line is not valid JSON: ${line}`);
  }
  const ev = parsed as { kind?: unknown };
  if (ev.kind !== "threshold" && ev.kind !== "decision" && ev.kind !== "outcome") {
    throw new JournalStoreError(
      `unknown journal event kind ${JSON.stringify(ev.kind)}. Refusing to skip ` +
        "it: a log written by a newer version and silently partially read " +
        "yields a calibration number over decisions that were dropped.",
    );
  }
  return parsed as JournalEvent;
}

/**
 * A journal that writes every mutation through to an append-only log.
 *
 * Wraps rather than extends `DecisionJournal`, so the in-memory class stays
 * usable on its own and there is exactly one place that knows about durability.
 */
export class PersistentJournal {
  readonly #sink: AppendSink;
  #journal: DecisionJournal;
  readonly #now: () => number;

  private constructor(sink: AppendSink, journal: DecisionJournal, now: () => number) {
    this.#sink = sink;
    this.#journal = journal;
    this.#now = now;
  }

  /** Open a journal, replaying whatever the sink already holds. */
  static open(sink: AppendSink, now: () => number = Date.now): PersistentJournal {
    const policies: ThresholdPolicy[] = [];
    const records = new Map<string, DecisionRecord>();
    for (const line of sink.readAll()) {
      if (!line.trim()) continue;
      const ev = decode(line);
      if (ev.kind === "threshold") {
        policies.push(ev.policy);
      } else if (ev.kind === "decision") {
        records.set(ev.record.id, ev.record);
      } else {
        const rec = records.get(ev.id);
        if (!rec) {
          throw new JournalStoreError(
            `outcome for unknown decision ${ev.id}; the log is truncated or reordered`,
          );
        }
        if (rec.outcome !== null) {
          throw new JournalStoreError(
            `${ev.id} is resolved twice in the log. Reality happens once; a log ` +
              "that says otherwise cannot be replayed into a trustworthy journal.",
          );
        }
        records.set(ev.id, { ...rec, outcome: ev.outcome, outcomeAt: ev.outcomeAt });
      }
    }
    const journal = DecisionJournal.replay(policies, [...records.values()], now);
    return new PersistentJournal(sink, journal, now);
  }

  setThreshold(action: string, tau: number, setBy: string, reason: string): ThresholdPolicy {
    const policy = this.#journal.setThreshold(action, tau, setBy, reason);
    this.#sink.append(encode({ kind: "threshold", policy }));
    return policy;
  }

  record(action: string, answer: string, confidence: number, note = ""): DecisionRecord {
    const rec = this.#journal.record(action, answer, confidence, note);
    this.#sink.append(encode({ kind: "decision", record: rec }));
    return rec;
  }

  resolve(id: string, wasCorrect: boolean): DecisionRecord {
    const rec = this.#journal.resolve(id, wasCorrect);
    this.#sink.append(
      encode({ kind: "outcome", id, outcome: wasCorrect, outcomeAt: rec.outcomeAt as number }),
    );
    return rec;
  }

  /**
   * Read-through delegates.
   *
   * These exist because of a bug caught the first time this was wired up. Only
   * `record`/`resolve`/`setThreshold` were on this class, so anything needing
   * a read -- such as `promote()`, which must consult `paperMetricsPassed` --
   * had to be handed `.journal` instead. Passing `.journal` gets the IN-MEMORY
   * object, whose writes never reach the log. The wiring looked correct, the
   * threshold line appeared in the file, and every decision was silently lost.
   *
   * A durable wrapper that is missing the read half of the interface pushes
   * every caller onto the path that bypasses it. So the whole read surface
   * lives here, and `promote(persistentJournal, ...)` now persists.
   */
  paperMetricsPassed(
    action: string,
    opts: { baseline: number; margin?: number; minResolved?: number },
  ): { passed: boolean; reason: string } {
    return this.#journal.paperMetricsPassed(action, opts);
  }

  calibration(
    action?: string,
    opts: { buckets?: number; onlyThresholdVersion?: number } = {},
  ): ReturnType<DecisionJournal["calibration"]> {
    return this.#journal.calibration(action, opts);
  }

  all(action?: string): readonly DecisionRecord[] {
    return this.#journal.all(action);
  }

  pending(action?: string): readonly DecisionRecord[] {
    return this.#journal.pending(action);
  }

  thresholdFor(action: string): ThresholdPolicy {
    return this.#journal.thresholdFor(action);
  }

  thresholdHistory(action: string): readonly ThresholdPolicy[] {
    return this.#journal.thresholdHistory(action);
  }

  policyAtVersion(action: string, version: number): ThresholdPolicy {
    return this.#journal.policyAtVersion(action, version);
  }

  /** The underlying in-memory journal. Prefer the delegates above: writes made
   *  directly on this object do NOT reach the log. */
  get journal(): DecisionJournal {
    return this.#journal;
  }
}

// --- the paper clock -------------------------------------------------------

export interface PaperRunStatus {
  readonly startedAt: number;
  readonly now: number;
  readonly elapsedDays: number;
  readonly requiredDays: number;
  readonly daysRemaining: number;
  readonly satisfied: boolean;
  readonly decisions: number;
  readonly resolved: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Elapsed paper-run time, derived from the FIRST decision in the log.
 *
 * Derived, not stored in a separate field anyone can set. A `started_at`
 * written by hand is a number asserting a run happened; the timestamp of the
 * earliest recorded decision is evidence one did. They differ exactly when it
 * matters -- when someone wants the clock to have started earlier than the
 * work did.
 */
export function paperRunStatus(
  journal: DecisionJournal,
  requiredDays: number,
  now: number,
  action?: string,
): PaperRunStatus {
  if (!(requiredDays > 0)) {
    throw new JournalStoreError(
      `requiredDays must be positive; got ${requiredDays}. A zero-day minimum ` +
        "is not a gate.",
    );
  }
  const rows = journal.all(action);
  if (rows.length === 0) {
    return {
      startedAt: Number.NaN, now, elapsedDays: 0, requiredDays,
      daysRemaining: requiredDays, satisfied: false, decisions: 0, resolved: 0,
    };
  }
  const startedAt = Math.min(...rows.map((r) => r.at));
  const elapsedDays = (now - startedAt) / MS_PER_DAY;
  const resolved = rows.filter((r) => r.outcome !== null).length;
  return {
    startedAt,
    now,
    elapsedDays,
    requiredDays,
    daysRemaining: Math.max(0, requiredDays - elapsedDays),
    satisfied: elapsedDays >= requiredDays,
    decisions: rows.length,
    resolved,
  };
}

// --- the file sink ---------------------------------------------------------

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Append-only file sink.
 *
 * `appendFileSync` with the default "a" flag is the whole durability story: a
 * single write syscall per event, and a crash mid-append truncates at most the
 * last line rather than corrupting the file. Nothing here ever opens the log
 * for writing in place.
 *
 * A missing file reads as empty, which is how a first run starts. A missing
 * DIRECTORY is created, because refusing to start a paper run over a path
 * typo is worse than making the directory.
 */
export class FileSink implements AppendSink {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  get path(): string {
    return this.#path;
  }

  append(line: string): void {
    appendFileSync(this.#path, `${line}\n`, "utf8");
  }

  readAll(): readonly string[] {
    let text: string;
    try {
      text = readFileSync(this.#path, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    return text.split("\n");
  }
}
