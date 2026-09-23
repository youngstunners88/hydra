import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { PlaneGuard, PlaneViolation } from "../../core/src/planeGuard.ts";
import { RESOLVE_METHODS, RpcChainReader } from "../src/sources/rpcChainReader.ts";

const W = "0x" + "a".repeat(40);

describe("RpcChainReader plane safety", () => {
  it("allows only three read methods, none of them a write", () => {
    assert.deepEqual([...RESOLVE_METHODS].sort(),
      ["eth_blockNumber", "eth_getBalance", "eth_getBlockByNumber"]);
  });

  it("asserts before the fetch, so a refused method never leaves the process", async () => {
    let fetched = 0;
    const guard = new PlaneGuard("hunt", ["eth_blockNumber"]);
    const r = new RpcChainReader(async () => { fetched += 1; return "0x1"; }, guard);
    await assert.rejects(() => r.balanceAt(W, 1), PlaneViolation);
    assert.equal(fetched, 0);
  });

  it("refuses a mixed-case or malformed address before any read", async () => {
    let fetched = 0;
    const r = new RpcChainReader(async () => { fetched += 1; return "0x1"; });
    await assert.rejects(() => r.balanceAt("0xABC", 1), /20-byte/);
    assert.equal(fetched, 0);
  });

  it("refuses a balance that is not a hex quantity", async () => {
    const r = new RpcChainReader(async () => "lots");
    await assert.rejects(() => r.balanceAt(W, 1), /hex quantity/);
  });
});
