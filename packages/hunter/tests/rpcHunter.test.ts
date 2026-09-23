import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { PlaneGuard, PlaneViolation } from "../../core/src/planeGuard.ts";
import {
  RPC_HUNT_METHODS, RpcHunter, RpcHunterError, isEoaTransfer, weiToNative,
} from "../src/sources/rpcHunter.ts";
import type { RpcBlock, RpcTransaction } from "../src/sources/rpcHunter.ts";

const HEX = (n: number) => `0x${n.toString(16)}`;
const wei = (n: number) => `0x${(BigInt(n) * 10n ** 18n).toString(16)}`;

function tx(over: Partial<RpcTransaction> = {}): RpcTransaction {
  return { hash: "0xh", from: "0xAAA", to: "0xBBB", value: wei(10), ...over };
}

function fakeRpc(blocks: Record<number, RpcBlock>, head: number) {
  const calls: string[] = [];
  const fetchJson = async (method: string, params: readonly unknown[]) => {
    calls.push(method);
    if (method === "eth_blockNumber") return HEX(head);
    if (method === "eth_getBlockByNumber") {
      const h = Number(BigInt(params[0] as string));
      return blocks[h] ?? null;
    }
    throw new Error(`unexpected ${method}`);
  };
  return { fetchJson, calls };
}

function block(number: number, txs: RpcTransaction[], ts = 1_700_000_000): RpcBlock {
  return { number: HEX(number), timestamp: HEX(ts), transactions: txs };
}

function hunter(over: Partial<Parameters<typeof makeOpts>[0]> = {}) {
  return new RpcHunter(makeOpts(over));
}

function makeOpts(over: {
  blocks?: number; minNativeValue?: number; fetchJson?: unknown; guard?: PlaneGuard;
} = {}) {
  const { fetchJson } = fakeRpc({ 100: block(100, [tx()]) }, 100);
  return {
    chain: "369" as const,
    endpoint: "http://localhost",
    blocks: over.blocks ?? 1,
    minNativeValue: over.minNativeValue ?? 1,
    fetchJson: (over.fetchJson ?? fetchJson) as never,
    guard: over.guard,
  };
}

describe("weiToNative", () => {
  it("converts whole units exactly", () => {
    assert.equal(weiToNative(wei(7)), 7);
  });

  it("keeps precision on a large balance", () => {
    // Number(BigInt) before dividing would lose the low bits.
    assert.equal(weiToNative(wei(1_000_000)), 1_000_000);
  });

  it("handles zero", () => {
    assert.equal(weiToNative("0x0"), 0);
  });

  it("refuses a non-hex quantity rather than yielding NaN", () => {
    // A NaN here compares false against every threshold, so the wallet is
    // silently skipped and the run looks quiet instead of broken.
    assert.throws(() => weiToNative("banana"), RpcHunterError);
  });
});

describe("isEoaTransfer", () => {
  it("rejects a contract deployment", () => {
    assert.equal(isEoaTransfer(tx({ to: null })), false);
  });
  it("accepts a transfer with a recipient", () => {
    assert.equal(isEoaTransfer(tx()), true);
  });
});

describe("RpcHunter plane safety", () => {
  it("sends ONLY the two declared read methods", async () => {
    const { fetchJson, calls } = fakeRpc({ 100: block(100, [tx()]) }, 100);
    await hunter({ fetchJson }).discover();
    assert.deepEqual([...new Set(calls)].sort(), [...RPC_HUNT_METHODS].sort());
  });

  it("declares no write method anywhere in its allowlist", () => {
    // The hunt plane never signs. This asserts the list itself, so adding a
    // write method to RPC_HUNT_METHODS fails here rather than at runtime.
    for (const m of RPC_HUNT_METHODS) {
      assert.match(m, /^eth_(blockNumber|getBlockByNumber)$/);
    }
  });

  it("refuses a method outside the allowlist, via the guard", () => {
    const guard = new PlaneGuard("hunt", RPC_HUNT_METHODS);
    assert.equal(guard.permits("eth_sendRawTransaction"), false);
    assert.throws(() => guard.assert("eth_sendRawTransaction"), PlaneViolation);
  });

  it("asserts BEFORE the fetch, so a refused method never leaves the process", async () => {
    let fetched = 0;
    const guard = new PlaneGuard("hunt", ["eth_getBlockByNumber"]); // blockNumber missing
    const h = hunter({ guard, fetchJson: async () => { fetched += 1; return HEX(1); } });
    await assert.rejects(() => h.discover(), PlaneViolation);
    assert.equal(fetched, 0);
  });
});

describe("RpcHunter.discover", () => {
  it("emits an observation for a sender above the value floor", async () => {
    const { fetchJson } = fakeRpc({ 100: block(100, [tx({ from: "0xDeAd", value: wei(50) })]) }, 100);
    const got = await hunter({ fetchJson, minNativeValue: 10 }).discover();
    assert.equal(got.length, 1);
    assert.equal(got[0]?.address, "0xdead");
    assert.equal(got[0]?.chain, "369");
  });

  it("drops a sender below the value floor", async () => {
    const { fetchJson } = fakeRpc({ 100: block(100, [tx({ value: wei(1) })]) }, 100);
    assert.equal((await hunter({ fetchJson, minNativeValue: 10 }).discover()).length, 0);
  });

  it("counts a wallet ONCE even when it sent several qualifying transfers", async () => {
    // Counting it per-transaction inflates every rate computed downstream.
    const { fetchJson } = fakeRpc({
      100: block(100, [
        tx({ from: "0xAAA", hash: "0x1", value: wei(50) }),
        tx({ from: "0xAAA", hash: "0x2", value: wei(60) }),
      ]),
    }, 100);
    const got = await hunter({ fetchJson, minNativeValue: 10 }).discover();
    assert.equal(got.length, 1);
  });

  it("keeps the FIRST qualifying transfer for a wallet, not the last", async () => {
    // The count above holds either way, because the output map dedups by
    // address on its own. What the explicit skip decides is WHICH evidence
    // survives -- and the first is the one from the newest block, since the
    // scan walks backwards from the head. Without this the observation would
    // silently carry the oldest transfer as its evidence while the run still
    // reported the right number of wallets. A mutation test caught that the
    // count assertion alone did not pin this down.
    const { fetchJson } = fakeRpc({
      100: block(100, [tx({ from: "0xAAA", hash: "0xnewest", value: wei(50) })]),
      99: block(99, [tx({ from: "0xAAA", hash: "0xolder", value: wei(60) })]),
    }, 100);
    const got = await hunter({ fetchJson, blocks: 2, minNativeValue: 10 }).discover();
    assert.equal(got.length, 1);
    assert.equal((got[0]?.raw as { txHash: string }).txHash, "0xnewest");
  });

  it("lowercases the address, so the same wallet never appears twice", async () => {
    const { fetchJson } = fakeRpc({
      100: block(100, [
        tx({ from: "0xABC", hash: "0x1", value: wei(50) }),
        tx({ from: "0xabc", hash: "0x2", value: wei(50) }),
      ]),
    }, 100);
    assert.equal((await hunter({ fetchJson, minNativeValue: 10 }).discover()).length, 1);
  });

  it("skips contract deployments", async () => {
    const { fetchJson } = fakeRpc({ 100: block(100, [tx({ to: null, value: wei(99) })]) }, 100);
    assert.equal((await hunter({ fetchJson, minNativeValue: 1 }).discover()).length, 0);
  });

  it("scans the requested number of blocks back from the head", async () => {
    const { fetchJson } = fakeRpc({
      100: block(100, [tx({ from: "0xA", value: wei(50) })]),
      99: block(99, [tx({ from: "0xB", value: wei(50) })]),
      98: block(98, [tx({ from: "0xC", value: wei(50) })]),
    }, 100);
    const got = await hunter({ fetchJson, blocks: 3, minNativeValue: 10 }).discover();
    assert.deepEqual(got.map((o) => o.address).sort(), ["0xa", "0xb", "0xc"]);
  });

  it("stops at genesis rather than requesting a negative height", async () => {
    const { fetchJson } = fakeRpc({ 0: block(0, [tx({ value: wei(50) })]) }, 0);
    await hunter({ fetchJson, blocks: 5, minNativeValue: 10 }).discover();
  });

  it("carries the evidence on the observation", async () => {
    const { fetchJson } = fakeRpc({ 100: block(100, [tx({ hash: "0xfeed", value: wei(42) })]) }, 100);
    const got = await hunter({ fetchJson, minNativeValue: 1 }).discover();
    assert.deepEqual(got[0]?.raw, { blockNumber: HEX(100), txHash: "0xfeed", nativeValue: 42 });
  });

  it("refuses a block fetched without full transaction objects", async () => {
    // Hashes-only looks exactly like an empty block, which would read as
    // "nothing happened" and quietly produce a zero-observation run.
    const fetchJson = async (m: string) =>
      m === "eth_blockNumber" ? HEX(100) : { number: HEX(100), timestamp: HEX(1) };
    await assert.rejects(() => hunter({ fetchJson }).discover(), /transaction array/);
  });

  it("refuses a missing block rather than reporting an empty scan", async () => {
    const fetchJson = async (m: string) => (m === "eth_blockNumber" ? HEX(100) : null);
    await assert.rejects(() => hunter({ fetchJson }).discover(), /no block at height/);
  });

  it("refuses a zero-block scan at construction", () => {
    assert.throws(() => hunter({ blocks: 0 }), RpcHunterError);
  });

  it("refuses a negative value floor at construction", () => {
    assert.throws(() => hunter({ minNativeValue: -1 }), RpcHunterError);
  });

  it("does not write to any journal -- discovery and judgement stay apart", async () => {
    const h = hunter();
    assert.equal(typeof (h as unknown as { record?: unknown }).record, "undefined");
    assert.equal(typeof (h as unknown as { promote?: unknown }).promote, "undefined");
  });
});
