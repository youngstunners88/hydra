import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { CliArgsError, numberFlag, parseArgs } from "../src/cliArgs.ts";

const SPEC = { withValue: ["days", "min-value"], boolean: ["dry-run"] };

describe("parseArgs", () => {
  it("does NOT treat a flag's value as a positional", () => {
    // The actual bug: `--days 30` left "30" as the log path, so the status
    // tool read a nonexistent file and reported the clock had not started.
    const p = parseArgs(["--days", "30"], SPEC);
    assert.deepEqual(p.positional, []);
    assert.equal(p.flags["days"], "30");
  });

  it("keeps a real positional alongside flags", () => {
    const p = parseArgs(["ops/journal/x.jsonl", "--days", "30"], SPEC);
    assert.deepEqual(p.positional, ["ops/journal/x.jsonl"]);
  });

  it("handles a positional AFTER a flag and its value", () => {
    const p = parseArgs(["--days", "30", "some/path.jsonl"], SPEC);
    assert.deepEqual(p.positional, ["some/path.jsonl"]);
  });

  it("records boolean flags without consuming the next argument", () => {
    const p = parseArgs(["--dry-run", "some/path"], SPEC);
    assert.equal(p.booleans.has("dry-run"), true);
    assert.deepEqual(p.positional, ["some/path"]);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    // A silently dropped typo runs with a default nobody asked for.
    assert.throws(() => parseArgs(["--dayz", "30"], SPEC), CliArgsError);
  });

  it("refuses a value flag with nothing after it", () => {
    assert.throws(() => parseArgs(["--days"], SPEC), /needs a value/);
  });

  it("refuses a value flag followed by another flag", () => {
    assert.throws(() => parseArgs(["--days", "--dry-run"], SPEC), /needs a value/);
  });
});

describe("numberFlag", () => {
  it("returns the fallback when absent", () => {
    assert.equal(numberFlag(parseArgs([], SPEC), "days", 30), 30);
  });
  it("parses a supplied number", () => {
    assert.equal(numberFlag(parseArgs(["--days", "7"], SPEC), "days", 30), 7);
  });
  it("refuses a non-numeric value rather than yielding NaN", () => {
    assert.throws(() => numberFlag(parseArgs(["--days", "soon"], SPEC), "days", 30), CliArgsError);
  });
});
