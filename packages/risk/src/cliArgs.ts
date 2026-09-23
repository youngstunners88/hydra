/**
 * Argument parsing for the ops scripts.
 *
 * Extracted into a tested module because the inline version had a bug that
 * matters more than it looks: positional arguments were taken as
 * `argv.filter(a => !a.startsWith("--"))`, which keeps the VALUE of every
 * flag. `paper_status.ts --days 30` therefore read `30` as the log path,
 * found no such file, and reported "NOT STARTED -- no decisions journalled".
 *
 * That is a false negative on the one question the script exists to answer.
 * The clock had in fact started; the tool said it had not. A status tool that
 * under-reports is worse than no status tool, because the response to it is to
 * go looking for a bug in the thing that was working.
 */

export class CliArgsError extends Error {}

export interface FlagSpec {
  /** Flags that take a value, so the value is not read as a positional. */
  readonly withValue: readonly string[];
  /** Flags that stand alone. */
  readonly boolean?: readonly string[];
}

export interface ParsedArgs {
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string>>;
  readonly booleans: ReadonlySet<string>;
}

export function parseArgs(argv: readonly string[], spec: FlagSpec): ParsedArgs {
  const withValue = new Set(spec.withValue);
  const booleanFlags = new Set(spec.boolean ?? []);
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  const booleans = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    // pnpm forwards the `--` in `pnpm hunt -- --blocks 5` to the script
    // verbatim. Treated as an unknown flag, it crashed every pnpm-invoked run
    // -- including paper-run.yml's, which would have failed on its first
    // scheduled tick. Found by running through pnpm instead of `node` directly.
    if (arg === "--") continue;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (booleanFlags.has(name)) {
      booleans.add(name);
      continue;
    }
    if (withValue.has(name)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CliArgsError(`--${name} needs a value`);
      }
      flags[name] = value;
      i += 1; // consume it, so it is never read as a positional
      continue;
    }
    throw new CliArgsError(
      `unknown flag --${name}. Unknown flags are refused rather than ignored: ` +
        "a typo'd flag that is silently dropped runs with a default the caller " +
        "did not ask for.",
    );
  }
  return { positional, flags, booleans };
}

export function numberFlag(
  parsed: ParsedArgs, name: string, fallback: number,
): number {
  const raw = parsed.flags[name];
  if (raw === undefined) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new CliArgsError(`--${name} must be a number; got ${raw}`);
  return v;
}
