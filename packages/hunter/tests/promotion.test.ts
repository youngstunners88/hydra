import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DecisionJournal } from "../../risk/src/journal.ts";
import { PROMOTION_ACTION, promote } from "../src/promotion.ts";
import type { PromotionRequest } from "../src/promotion.ts";

const OPEN_GATES = {
  hasValidAddress: true,
  hasAtLeastOneSource: true,
  hasProfileAndSecurityFeatures: true,
  meetsWatchMinScore: true,
  isNotSybil: true,
  isConfirmedByHumanOrAutoPromote: true,
};

function req(over: Partial<PromotionRequest> = {}): PromotionRequest {
  return {
    walletId: "w1",
    from: "watchlisted",
    to: "trusted",
    confidence: 0.9,
    gates: OPEN_GATES,
    ...over,
  };
}

function journalWithResolved(n: number, hitRate: number, confidence = 0.8) {
  const j = new DecisionJournal();
  j.setThreshold(PROMOTION_ACTION, 0.7, "test", "fixture");
  const hits = Math.round(n * hitRate);
  for (let i = 0; i < n; i += 1) {
    const r = j.record(PROMOTION_ACTION, `w${i}`, confidence);
    j.resolve(r.id, i < hits);
  }
  return j;
}

describe("promote", () => {
  it("records the decision even when the promotion is REFUSED", () => {
    // Every "no" is a prediction. A journal holding only the promotions that
    // went ahead cannot be calibrated.
    const j = new DecisionJournal();
    j.setThreshold(PROMOTION_ACTION, 0.7, "test", "fixture");
    const out = promote(j, req(), { baseline: 0.5 });
    assert.equal(out.allowed, false);
    assert.equal(j.all(PROMOTION_ACTION).length, 1);
    assert.equal(j.all(PROMOTION_ACTION)[0]?.id, out.decisionId);
  });

  it("refuses watchlisted -> trusted on an empty journal", () => {
    const j = new DecisionJournal();
    j.setThreshold(PROMOTION_ACTION, 0.7, "test", "fixture");
    const out = promote(j, req(), { baseline: 0.5 });
    assert.equal(out.paperMetricsPassed, false);
    assert.match(out.paperMetricsReason, /absence/);
    assert.match(out.reason, /paper-copy metrics/);
  });

  it("refuses when resolved outcomes are UNDERPOWERED", () => {
    const j = journalWithResolved(20, 1.0);
    const out = promote(j, req(), { baseline: 0.5 });
    assert.equal(out.allowed, false);
    assert.match(out.paperMetricsReason, /UNDERPOWERED/);
  });

  it("allows the promotion once the journal actually earns it", () => {
    const j = journalWithResolved(120, 0.8);
    const out = promote(j, req(), { baseline: 0.5 });
    assert.equal(out.paperMetricsPassed, true);
    assert.equal(out.allowed, true);
  });

  it("refuses when the hit rate does not beat the stated baseline", () => {
    // 60% looks good until the baseline is 70%: most watchlisted wallets do
    // not deserve promotion, so "no" every time already scores well.
    const j = journalWithResolved(120, 0.6);
    assert.equal(promote(j, req(), { baseline: 0.5 }).paperMetricsPassed, true);
    assert.equal(promote(j, req(), { baseline: 0.7 }).paperMetricsPassed, false);
  });

  it("derives paperMetricsPassed and ignores any caller-supplied value", () => {
    // The whole defect this fixes: the flag used to be handed in.
    const j = new DecisionJournal();
    j.setThreshold(PROMOTION_ACTION, 0.7, "test", "fixture");
    const sneaky = {
      ...req(),
      gates: { ...OPEN_GATES, paperMetricsPassed: true },
    } as unknown as PromotionRequest;
    assert.equal(promote(j, sneaky, { baseline: 0.5 }).allowed, false);
  });

  it("still enforces the non-journal gates", () => {
    const j = journalWithResolved(120, 0.8);
    const out = promote(
      j,
      req({ from: "observed", to: "candidate", gates: { ...OPEN_GATES, hasValidAddress: false } }),
      { baseline: 0.5 },
    );
    assert.equal(out.allowed, false);
    assert.match(out.reason, /valid address/);
  });

  it("cannot skip a rank even with a fully earned journal", () => {
    const j = journalWithResolved(120, 0.8);
    const out = promote(j, req({ from: "watchlisted", to: "copy_enabled" }), {
      baseline: 0.5,
    });
    assert.equal(out.allowed, false);
    assert.match(out.reason, /not allowed/);
  });

  it("journals the confidence it was given, for later calibration", () => {
    const j = journalWithResolved(120, 0.8);
    const out = promote(j, req({ confidence: 0.42 }), { baseline: 0.5 });
    const rec = j.all(PROMOTION_ACTION).find((r) => r.id === out.decisionId);
    assert.equal(rec?.confidence, 0.42);
  });

  it("records the wallet and the transition in the answer", () => {
    const j = journalWithResolved(120, 0.8);
    const out = promote(j, req({ walletId: "abc" }), { baseline: 0.5 });
    const rec = j.all(PROMOTION_ACTION).find((r) => r.id === out.decisionId);
    assert.equal(rec?.answer, "abc:watchlisted->trusted");
  });

  it("does not resolve anything -- that is a separate act at a separate time", () => {
    const j = journalWithResolved(120, 0.8);
    const before = j.pending(PROMOTION_ACTION).length;
    promote(j, req(), { baseline: 0.5 });
    assert.equal(j.pending(PROMOTION_ACTION).length, before + 1);
  });
});
