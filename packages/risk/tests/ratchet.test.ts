import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  LadderError, floorPct, makeLadder, openPosition, run, tick,
} from "../src/ratchet.ts";

const LADDER = makeLadder({
  maxLossPct: 8,
  tiers: [{ triggerPct: 10, lockHwPct: 40 }, { triggerPct: 50, lockHwPct: 85 }],
});

describe("ladder construction refuses documented footguns", () => {
  it("refuses a tier that locks 0% of the peak", () => {
    assert.throws(
      () => makeLadder({ maxLossPct: 5, tiers: [{ triggerPct: 10, lockHwPct: 0 }] }),
      /loss dressed as breakeven/,
    );
  });
  it("refuses unsorted tiers", () => {
    assert.throws(
      () => makeLadder({ maxLossPct: 5, tiers: [
        { triggerPct: 50, lockHwPct: 80 }, { triggerPct: 10, lockHwPct: 40 }] }),
      /sorted ascending/,
    );
  });
  it("refuses duplicate triggers", () => {
    assert.throws(() => makeLadder({ maxLossPct: 5, tiers: [
      { triggerPct: 10, lockHwPct: 40 }, { triggerPct: 10, lockHwPct: 60 }] }), LadderError);
  });
  it("refuses locking more than the high-water mark", () => {
    assert.throws(() => makeLadder({ maxLossPct: 5, tiers: [
      { triggerPct: 10, lockHwPct: 101 }] }), /above the high-water mark/);
  });
  it("refuses a non-positive maxLossPct", () => {
    assert.throws(() => makeLadder({ maxLossPct: 0, tiers: [] }), /positive distance/);
  });
  it("refuses a non-positive entry", () => {
    assert.throws(() => openPosition(0), LadderError);
  });
});

describe("phase 1 survives", () => {
  it("cuts a loser at the hard floor", () => {
    assert.equal(run(LADDER, 100, [99, 95, 91.9]).closed, "phase1_stop");
  });
  it("holds just inside the floor", () => {
    // -7.9% against an 8% floor must survive; an off-by-one cuts winners early
    // and the loss gets blamed on the market.
    assert.equal(run(LADDER, 100, [92.1]).closed, null);
  });
  it("is inclusive exactly at the floor", () => {
    assert.equal(run(LADDER, 100, [92]).closed, "phase1_stop");
  });
  it("puts the phase-1 floor below entry", () => {
    assert.equal(floorPct(LADDER, openPosition(100)), -8);
  });
});

describe("phase 2 locks", () => {
  it("arms the first rung at its trigger", () => {
    const s = run(LADDER, 100, [110]);
    assert.equal(s.tierIndex, 0);
  });
  it("locks a share of the peak", () => {
    // peak +10%, first rung locks 40% -> floor at +4%
    assert.equal(floorPct(LADDER, run(LADDER, 100, [110])), 4);
  });
  it("closes as tier_breach when it falls back through a locked rung", () => {
    assert.equal(run(LADDER, 100, [110, 103]).closed, "tier_breach");
  });
  it("lets a runner run", () => {
    const s = run(LADDER, 100, [110, 130, 160, 200]);
    assert.equal(s.closed, null);
    assert.equal(s.tierIndex, 1);
  });
  it("only ever tightens -- a pullback cannot un-arm a rung", () => {
    const s = run(LADDER, 100, [160, 140]);
    assert.equal(s.tierIndex, 1);
    assert.equal(Math.round(s.peakPct), 60);
  });
  it("raises the floor on the higher rung", () => {
    // peak +60%, second rung locks 85% -> +51%, far above the first rung's +24%
    assert.equal(Math.round(floorPct(LADDER, run(LADDER, 100, [160]))), 51);
  });
  it("does not arm a rung a spike-and-collapse never held", () => {
    const s = run(LADDER, 100, [80]);
    assert.equal(s.closed, "phase1_stop");
    assert.equal(s.tierIndex, -1);
  });
});

describe("time-based exits", () => {
  it("closes on hard timeout even while fine", () => {
    const l = makeLadder({ maxLossPct: 20, tiers: [], hardTimeoutTicks: 3 });
    const s = run(l, 100, [101, 102, 103, 104]);
    assert.equal(s.closed, "hard_timeout");
    assert.equal(s.ticks, 3);
  });
  it("cuts dead weight that never got going", () => {
    const l = makeLadder({ maxLossPct: 20, tiers: [], weakPeakAfterTicks: 3, weakPeakMinPct: 3 });
    assert.equal(run(l, 100, [100.5, 101, 100.8]).closed, "weak_peak");
  });
  it("spares something that did get going", () => {
    const l = makeLadder({ maxLossPct: 20, tiers: [{ triggerPct: 4, lockHwPct: 40 }],
      weakPeakAfterTicks: 3, weakPeakMinPct: 3 });
    assert.equal(run(l, 100, [105, 104, 104.5]).closed, null);
  });
  it("prefers timeout over breach on the same tick", () => {
    const l = makeLadder({ maxLossPct: 5, tiers: [], hardTimeoutTicks: 2 });
    assert.equal(run(l, 100, [101, 50]).closed, "hard_timeout");
  });
});

describe("purity", () => {
  it("does not mutate the state it is given", () => {
    const before = openPosition(100);
    tick(LADDER, before, 110);
    assert.equal(before.peakPct, 0);
    assert.equal(before.tierIndex, -1);
    assert.equal(before.ticks, 0);
  });
  it("is a no-op on a closed position", () => {
    const closed = run(LADDER, 100, [90]);
    assert.equal(tick(LADDER, closed, 200), closed);
  });
  it("supports a plain stop with no tiers", () => {
    const l = makeLadder({ maxLossPct: 10, tiers: [] });
    assert.equal(run(l, 100, [200, 150]).closed, null);
    assert.equal(run(l, 100, [89]).closed, "phase1_stop");
  });
});
