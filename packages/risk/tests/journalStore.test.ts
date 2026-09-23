import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DecisionJournal } from "../src/journal.ts";
import {
  JournalStoreError, MemorySink, PersistentJournal, decode, encode, paperRunStatus,
} from "../src/journalStore.ts";

const DAY = 86_400_000;

function opened(now = () => 1_000) {
  const sink = new MemorySink();
  const j = PersistentJournal.open(sink, now);
  j.setThreshold("promo", 0.7, "test", "fixture");
  return { sink, j };
}

describe("PersistentJournal", () => {
  it("survives a restart: reopening the same log restores the decisions", () => {
    // The reason this file exists. An in-memory journal restarts the paper
    // clock on every redeploy and never reaches the minimum run length.
    const { sink, j } = opened();
    const a = j.record("promo", "w1", 0.9);
    j.resolve(a.id, true);
    j.record("promo", "w2", 0.4);

    const reopened = PersistentJournal.open(sink, () => 2_000);
    assert.equal(reopened.journal.all("promo").length, 2);
    assert.equal(reopened.journal.all("promo")[0]?.outcome, true);
    assert.equal(reopened.journal.pending("promo").length, 1);
  });

  it("restores calibration identically across a restart", () => {
    const { sink, j } = opened();
    for (let i = 0; i < 10; i += 1) {
      const r = j.record("promo", `w${i}`, 0.8);
      j.resolve(r.id, i < 8);
    }
    const before = j.journal.calibration("promo");
    const after = PersistentJournal.open(sink).journal.calibration("promo");
    assert.equal(after.resolved, before.resolved);
    assert.equal(after.brier, before.brier);
    assert.equal(after.baseRate, before.baseRate);
  });

  it("continues the id sequence so a replayed decision is never overwritten", () => {
    // Without this, record() after a restart reissues "d1" and silently
    // replaces a resolved decision with an unresolved one.
    const { sink, j } = opened();
    const first = j.record("promo", "w1", 0.9);
    j.resolve(first.id, true);

    const reopened = PersistentJournal.open(sink);
    const next = reopened.record("promo", "w2", 0.5);
    assert.notEqual(next.id, first.id);
    assert.equal(reopened.journal.all("promo").length, 2);
    assert.equal(
      reopened.journal.all("promo").find((r) => r.id === first.id)?.outcome,
      true,
    );
  });

  it("appends rather than rewriting: a resolve is a new line", () => {
    const { sink, j } = opened();
    const before = sink.lines.length;
    const r = j.record("promo", "w1", 0.9);
    j.resolve(r.id, true);
    assert.equal(sink.lines.length, before + 2);
  });

  it("replays a threshold revision without re-grading old decisions", () => {
    // Refusal #1, now enforced across a restart too.
    const { sink, j } = opened();
    const early = j.record("promo", "w1", 0.75);   // auto under tau 0.7
    j.setThreshold("promo", 0.9, "test", "raised");
    const late = j.record("promo", "w2", 0.75);    // escalated under tau 0.9

    const reopened = PersistentJournal.open(sink).journal;
    const rows = reopened.all("promo");
    assert.equal(rows.find((r) => r.id === early.id)?.route, "auto");
    assert.equal(rows.find((r) => r.id === late.id)?.route, "escalated");
    assert.equal(rows.find((r) => r.id === early.id)?.tauAtDecision, 0.7);
  });

  it("keeps every threshold version, so an old decision can be audited", () => {
    const { sink, j } = opened();
    j.setThreshold("promo", 0.9, "test", "raised");
    const restored = PersistentJournal.open(sink).journal;
    assert.equal(restored.thresholdHistory("promo").length, 2);
    assert.equal(restored.policyAtVersion("promo", 1).tau, 0.7);
    assert.equal(restored.policyAtVersion("promo", 2).tau, 0.9);
  });

  it("refuses an unknown event kind rather than skipping it", () => {
    // Skipping would drop decisions and still produce a confident-looking
    // calibration number over what remained.
    //
    // The message is asserted, not just the error type. A mutation that
    // removed the kind check still threw JournalStoreError -- from the
    // outcome handler, on a record it could not find -- so a type-only
    // assertion passed for entirely the wrong reason.
    const sink = new MemorySink();
    sink.append(JSON.stringify({ kind: "teleport", record: {} }));
    assert.throws(
      () => PersistentJournal.open(sink),
      (e: unknown) =>
        e instanceof JournalStoreError && /unknown journal event kind/.test(e.message),
    );
  });

  it("refuses a log line that is not JSON", () => {
    const sink = new MemorySink();
    sink.append("{not json");
    assert.throws(() => PersistentJournal.open(sink), JournalStoreError);
  });

  it("refuses an outcome for a decision the log never recorded", () => {
    const sink = new MemorySink();
    sink.append(encode({ kind: "outcome", id: "d9", outcome: true, outcomeAt: 1 }));
    assert.throws(() => PersistentJournal.open(sink), /truncated or reordered/);
  });

  it("refuses a log that resolves the same decision twice", () => {
    const { sink, j } = opened();
    const r = j.record("promo", "w1", 0.9);
    j.resolve(r.id, true);
    sink.append(encode({ kind: "outcome", id: r.id, outcome: false, outcomeAt: 2 }));
    assert.throws(() => PersistentJournal.open(sink), /resolved twice/);
  });

  it("ignores blank lines, which a trailing newline produces", () => {
    const { sink, j } = opened();
    j.record("promo", "w1", 0.9);
    sink.append("");
    assert.equal(PersistentJournal.open(sink).journal.all("promo").length, 1);
  });

  it("round-trips an event through encode/decode", () => {
    const ev = { kind: "outcome", id: "d1", outcome: false, outcomeAt: 7 } as const;
    assert.deepEqual(decode(encode(ev)), ev);
  });
});

describe("paperRunStatus", () => {
  function journalWith(times: number[]) {
    let t = 0;
    const j = new DecisionJournal(() => t);
    j.setThreshold("promo", 0.7, "test", "fixture");
    for (const at of times) {
      t = at;
      j.record("promo", "w", 0.8);
    }
    return j;
  }

  it("is unsatisfied and reports zero elapsed on an empty journal", () => {
    const j = new DecisionJournal();
    const s = paperRunStatus(j, 30, 0);
    assert.equal(s.satisfied, false);
    assert.equal(s.elapsedDays, 0);
    assert.equal(s.decisions, 0);
    assert.equal(s.daysRemaining, 30);
  });

  it("measures from the EARLIEST decision, not the latest", () => {
    const j = journalWith([0, 10 * DAY, 20 * DAY]);
    assert.equal(paperRunStatus(j, 30, 20 * DAY).elapsedDays, 20);
  });

  it("is not satisfied one instant before the requirement", () => {
    const j = journalWith([0]);
    assert.equal(paperRunStatus(j, 30, 30 * DAY - 1).satisfied, false);
    assert.equal(paperRunStatus(j, 30, 30 * DAY).satisfied, true);
  });

  it("counts resolved separately from recorded", () => {
    let t = 0;
    const j = new DecisionJournal(() => t);
    j.setThreshold("promo", 0.7, "test", "fixture");
    const a = j.record("promo", "w1", 0.8);
    j.record("promo", "w2", 0.8);
    j.resolve(a.id, true);
    const s = paperRunStatus(j, 30, DAY);
    assert.equal(s.decisions, 2);
    assert.equal(s.resolved, 1);
  });

  it("refuses a zero-day minimum, which is not a gate", () => {
    assert.throws(() => paperRunStatus(new DecisionJournal(), 0, 0), JournalStoreError);
  });

  it("scopes the clock to one action when asked", () => {
    let t = 0;
    const j = new DecisionJournal(() => t);
    j.setThreshold("promo", 0.7, "test", "fixture");
    j.setThreshold("other", 0.7, "test", "fixture");
    j.record("other", "x", 0.8);
    t = 10 * DAY;
    j.record("promo", "w", 0.8);
    assert.equal(paperRunStatus(j, 30, 10 * DAY, "promo").elapsedDays, 0);
    assert.equal(paperRunStatus(j, 30, 10 * DAY).elapsedDays, 10);
  });
});

describe("PersistentJournal as a PromotionJournal", () => {
  it("persists decisions made through the wrapper, not just thresholds", () => {
    // The bug this test exists for: `promote()` needs a read method
    // (paperMetricsPassed) as well as record(). When the wrapper lacked it,
    // callers passed `.journal` instead -- the in-memory object -- and every
    // decision was silently dropped while the threshold line still appeared
    // in the log, so the wiring looked like it worked.
    const sink = new MemorySink();
    const j = PersistentJournal.open(sink);
    j.setThreshold("promo", 0.7, "test", "fixture");

    const verdict = j.paperMetricsPassed("promo", { baseline: 0.5 });
    assert.equal(verdict.passed, false);
    j.record("promo", "w1", 0.8);

    assert.equal(PersistentJournal.open(sink).all("promo").length, 1);
  });

  it("exposes the read surface so callers never need .journal", () => {
    const sink = new MemorySink();
    const j = PersistentJournal.open(sink);
    j.setThreshold("promo", 0.7, "test", "fixture");
    const r = j.record("promo", "w1", 0.8);
    j.resolve(r.id, true);

    assert.equal(j.all("promo").length, 1);
    assert.equal(j.pending("promo").length, 0);
    assert.equal(j.thresholdFor("promo").tau, 0.7);
    assert.equal(j.thresholdHistory("promo").length, 1);
    assert.equal(j.policyAtVersion("promo", 1).tau, 0.7);
    assert.equal(j.calibration("promo").resolved, 1);
  });
});
