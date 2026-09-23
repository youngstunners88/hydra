import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isCovered, reconcile, summarize } from "../src/coverage.ts";

const keys = { keyOfExpected: (s: string) => s, keyOfActual: (s: string) => s };

describe("absence detection", () => {
  it("flags an open position that nothing is protecting", () => {
    const c = reconcile(["BTC", "ETH", "SOL"], ["BTC", "SOL"], keys);
    assert.deepEqual(c.uncovered, ["ETH"]);
    assert.equal(isCovered(c), false);
  });
  it("passes when everything is protected", () => {
    const c = reconcile(["BTC", "ETH"], ["ETH", "BTC"], keys);
    assert.equal(isCovered(c), true);
  });
  it("treats an empty expected set as VACUOUS and never ok", () => {
    // A trivial pass is the most dangerous output: an empty expected set
    // usually means the query that built it broke.
    const c = reconcile([], [], keys);
    assert.equal(c.vacuous, true);
    assert.equal(isCovered(c), false);
    assert.match(summarize(c), /proves nothing/);
  });
  it("does not call a total failure vacuous", () => {
    const c = reconcile(["a", "b", "c"], [], keys);
    assert.equal(c.vacuous, false);
    assert.deepEqual(c.uncovered, ["a", "b", "c"]);
  });
  it("counts tracked-but-no-floor as degraded, not healthy", () => {
    const c = reconcile(
      [{ id: "BTC" }, { id: "ETH" }],
      [{ id: "BTC", floor: 90 }, { id: "ETH", floor: null as number | null }],
      {
        keyOfExpected: (r) => r.id,
        keyOfActual: (r) => r.id,
        healthy: (r) => r.floor !== null,
        whyUnhealthy: () => "tracked but carries no floor price",
      },
    );
    assert.deepEqual(c.degraded, ["ETH"]);
    assert.deepEqual(c.healthy, ["BTC"]);
    assert.equal(c.notes["ETH"], "tracked but carries no floor price");
    assert.equal(isCovered(c), false);
  });
  it("reports orphans without failing the check", () => {
    const c = reconcile(["BTC"], ["BTC", "DOGE"], keys);
    assert.deepEqual(c.orphaned, ["DOGE"]);
    assert.equal(isCovered(c), true);
  });
  it("compares dissimilar record shapes through the key", () => {
    const c = reconcile(
      [{ asset: "BTC" }],
      [{ coin: "BTC", floor: 1 }],
      { keyOfExpected: (r) => r.asset, keyOfActual: (r) => r.coin },
    );
    assert.equal(isCovered(c), true);
  });
  it("names the unprotected position in the summary", () => {
    assert.match(summarize(reconcile(["ETH"], [], keys)), /UNPROTECTED.*ETH/);
  });
});
