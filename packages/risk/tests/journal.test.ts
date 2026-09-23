import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  DecisionJournal, JournalError, MIN_RESOLVED_FOR_VERDICT,
} from "../src/journal.ts";

const j = () => {
  const d = new DecisionJournal();
  d.setThreshold("copy_enable", 0.9, "chris", "initial policy");
  return d;
};

describe("thresholds are governed policy, not constants", () => {
  it("refuses an unregistered action rather than defaulting permissive", () => {
    assert.throws(() => new DecisionJournal().record("unknown", "y", 0.99),
      /must not default to permissive/);
  });
  it("refuses an unowned threshold", () => {
    assert.throws(() => new DecisionJournal().setThreshold("a", 0.9, "  ", "r"),
      /needs an owner/);
  });
  it("refuses a threshold change with no stated reason", () => {
    assert.throws(() => new DecisionJournal().setThreshold("a", 0.9, "chris", " "),
      /stated reason/);
  });
  it("refuses tau outside (0,1]", () => {
    assert.throws(() => new DecisionJournal().setThreshold("a", 0, "c", "r"), JournalError);
    assert.throws(() => new DecisionJournal().setThreshold("a", 1.5, "c", "r"), JournalError);
  });
  it("revising a threshold makes a NEW version, never an edit", () => {
    const d = j();
    assert.equal(d.thresholdFor("copy_enable").version, 1);
    d.setThreshold("copy_enable", 0.8, "chris", "loosened after review");
    assert.equal(d.thresholdFor("copy_enable").version, 2);
  });
});

describe("routing is derived, never passed in", () => {
  it("acts alone at or above tau", () => {
    assert.equal(j().record("copy_enable", "yes", 0.95).route, "auto");
  });
  it("escalates below tau -- the middle band is the whole point", () => {
    assert.equal(j().record("copy_enable", "yes", 0.6).route, "escalated");
  });
  it("is inclusive exactly at tau", () => {
    assert.equal(j().record("copy_enable", "yes", 0.9).route, "auto");
  });
  it("refuses a confidence outside [0,1]", () => {
    assert.throws(() => j().record("copy_enable", "y", 1.2), JournalError);
  });
});

describe("one row, two writes", () => {
  it("records the threshold VERSION in force at decision time", () => {
    const d = j();
    const before = d.record("copy_enable", "yes", 0.95);
    d.setThreshold("copy_enable", 0.99, "chris", "tightened");
    const after = d.record("copy_enable", "yes", 0.95);
    assert.equal(before.thresholdVersion, 1);
    assert.equal(before.route, "auto");
    assert.equal(after.thresholdVersion, 2);
    // Same confidence, different policy -> different route. The earlier row is
    // NOT re-graded: raising tau later must not retroactively make a past
    // decision look reckless.
    assert.equal(after.route, "escalated");
  });
  it("resolves once and only once", () => {
    const d = j();
    const r = d.record("copy_enable", "yes", 0.95);
    d.resolve(r.id, true);
    assert.throws(() => d.resolve(r.id, false), /Reality happens once/);
  });
  it("surfaces decisions that never got an outcome", () => {
    const d = j();
    d.record("copy_enable", "yes", 0.95);
    const r2 = d.record("copy_enable", "no", 0.2);
    d.resolve(r2.id, true);
    assert.equal(d.pending("copy_enable").length, 1);
  });
  it("refuses to resolve an unknown decision", () => {
    assert.throws(() => j().resolve("nope", true), JournalError);
  });
});

describe("calibration", () => {
  it("is VACUOUS with nothing resolved, never a pass", () => {
    const d = j();
    d.record("copy_enable", "yes", 0.95);
    const r = d.calibration("copy_enable");
    assert.equal(r.vacuous, true);
    assert.equal(r.resolved, 0);
    assert.equal(r.pending, 1);
  });
  it("computes Brier against the resolved outcome", () => {
    const d = j();
    const a = d.record("copy_enable", "yes", 1.0);
    d.resolve(a.id, true);            // (1.0 - 1)^2 = 0
    const b = d.record("copy_enable", "yes", 0.0);
    d.resolve(b.id, false);           // (0.0 - 0)^2 = 0
    assert.equal(d.calibration("copy_enable").brier, 0);
  });
  it("gives a perfectly wrong forecaster a Brier of 1", () => {
    const d = j();
    const a = d.record("copy_enable", "yes", 1.0);
    d.resolve(a.id, false);
    assert.equal(d.calibration("copy_enable").brier, 1);
  });
  it("omits empty buckets rather than scoring them zero", () => {
    const d = j();
    const a = d.record("copy_enable", "yes", 0.95);
    d.resolve(a.id, true);
    const r = d.calibration("copy_enable");
    assert.equal(r.buckets.length, 1);
    assert.equal(r.buckets[0]!.n, 1);
  });
  it("can restrict to one threshold version", () => {
    const d = j();
    const a = d.record("copy_enable", "yes", 0.95);
    d.resolve(a.id, true);
    d.setThreshold("copy_enable", 0.5, "chris", "loosened");
    const b = d.record("copy_enable", "yes", 0.6);
    d.resolve(b.id, false);
    assert.equal(d.calibration("copy_enable", { onlyThresholdVersion: 1 }).resolved, 1);
    assert.equal(d.calibration("copy_enable").resolved, 2);
  });
  it("reports the base rate, not an assumed 0.5", () => {
    const d = j();
    for (let i = 0; i < 4; i += 1) {
      const r = d.record("copy_enable", "yes", 0.9);
      d.resolve(r.id, i < 3);
    }
    assert.equal(d.calibration("copy_enable").baseRate, 0.75);
  });
});

describe("paperMetricsPassed is derived and cannot be asserted", () => {
  const fill = (d: DecisionJournal, n: number, correct: number, conf = 0.9) => {
    for (let i = 0; i < n; i += 1) {
      const r = d.record("copy_enable", "yes", conf);
      d.resolve(r.id, i < correct);
    }
  };

  it("fails on an absence rather than passing vacuously", () => {
    const out = j().paperMetricsPassed("copy_enable", { baseline: 0.5 });
    assert.equal(out.passed, false);
    assert.match(out.reason, /it is an absence/);
  });
  it("refuses a short clean streak as UNDERPOWERED", () => {
    const d = j();
    fill(d, 20, 20);                 // 20 for 20 looks like proof
    const out = d.paperMetricsPassed("copy_enable", { baseline: 0.5 });
    assert.equal(out.passed, false);
    assert.match(out.reason, /UNDERPOWERED/);
  });
  it("passes only when powered AND beating the baseline by the margin", () => {
    const d = j();
    fill(d, MIN_RESOLVED_FOR_VERDICT, MIN_RESOLVED_FOR_VERDICT);
    const out = d.paperMetricsPassed("copy_enable", { baseline: 0.5, margin: 0.05 });
    assert.equal(out.passed, true);
  });
  it("fails a powered run that merely matches the baseline", () => {
    const d = j();
    fill(d, 200, 100);               // exactly 50%, baseline 50%
    const out = d.paperMetricsPassed("copy_enable", { baseline: 0.5, margin: 0.05 });
    assert.equal(out.passed, false);
    assert.match(out.reason, /does not beat baseline/);
  });
  it("uses the derived 97-per-bin floor by default", () => {
    assert.equal(MIN_RESOLVED_FOR_VERDICT, 97);
  });
});
