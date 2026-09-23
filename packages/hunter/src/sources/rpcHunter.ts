/**
 * The first real hunter: candidate wallets from public PulseChain blocks.
 *
 * WHY THIS SHAPE
 *
 * The paper clock is the age of the oldest journalled decision, so it cannot
 * start until something real produces observations. Everything in `packages/`
 * was a library waiting for a caller. This is the caller.
 *
 * It reads recent blocks over JSON-RPC and emits the SENDERS of transactions
 * that cleared a notional floor. That is the crudest possible smart-money
 * signal and it is deliberately crude: the point of this file is to start the
 * calibration clock with honest, reproducible observations, not to be a good
 * strategy. A bad signal that is measured beats a good one that is asserted --
 * and the journal will say which this is within 97 resolved outcomes.
 *
 * WHAT IT WILL NOT DO
 *
 * Only `eth_blockNumber` and `eth_getBlockByNumber` are ever sent. Both are
 * reads. There is no signer, no key, no venue and no write method anywhere in
 * this file, and `RPC_HUNT_METHODS` is the closed set the PlaneGuard is built
 * from -- a method not on that list cannot be dispatched even by a typo,
 * because `send()` asserts against the guard before the fetch.
 *
 * KNOWN BIAS, STATED UP FRONT
 *
 * Reading only the head of the chain selects for wallets that are active RIGHT
 * NOW. That is survivorship bias in the sampling frame itself: wallets that
 * made one excellent trade last week are invisible. This is the same
 * selection problem recorded in the edge inventory, and it is not fixed here.
 * It is disclosed so the calibration numbers are read as "calibrated on
 * recently-active wallets", which is what they will actually be.
 */

import type { ChainId, Observation } from "@hydra/core";
import { PlaneGuard } from "@hydra/core/planeGuard.ts";

/** The only JSON-RPC methods this hunter may ever send. Both are reads. */
export const RPC_HUNT_METHODS: readonly string[] = [
  "eth_blockNumber",
  "eth_getBlockByNumber",
];

export interface RpcTransaction {
  readonly hash: string;
  readonly from: string;
  readonly to: string | null;
  /** Hex wei. */
  readonly value: string;
}

export interface RpcBlock {
  readonly number: string;
  readonly timestamp: string;
  readonly transactions: readonly RpcTransaction[];
}

export type JsonRpcFetch = (
  method: string,
  params: readonly unknown[],
) => Promise<unknown>;

export interface RpcHunterOptions {
  readonly chain: ChainId;
  readonly endpoint: string;
  /** How many blocks back from the head to scan. */
  readonly blocks: number;
  /** Minimum transaction value, in whole native units, to count as a signal. */
  readonly minNativeValue: number;
  readonly fetchJson: JsonRpcFetch;
  readonly guard?: PlaneGuard;
}

export class RpcHunterError extends Error {}

const WEI = 10n ** 18n;

/** Hex wei -> whole native units, as a float. Precision is fine for a threshold. */
export function weiToNative(hexWei: string): number {
  let v: bigint;
  try {
    v = BigInt(hexWei);
  } catch {
    throw new RpcHunterError(`not a hex quantity: ${hexWei}`);
  }
  if (v < 0n) throw new RpcHunterError(`negative value: ${hexWei}`);
  // Integer part exactly, fractional part to 6 places. Avoids Number(v) losing
  // the low bits of a large balance before the division even happens.
  const whole = v / WEI;
  const frac = Number((v % WEI) / 10n ** 12n) / 1e6;
  return Number(whole) + frac;
}

export function isEoaTransfer(tx: RpcTransaction): boolean {
  // `to: null` is a contract deployment, not a transfer between parties.
  return tx.to !== null;
}

/**
 * A hunter over public JSON-RPC reads.
 *
 * `discover()` returns observations; it never promotes, never resolves and
 * never writes to the journal. Deciding what an observation means is
 * `promote()`'s job, and keeping the two apart is what stops a hunter from
 * grading its own homework.
 */
export class RpcHunter {
  readonly id = "pulsechain-rpc-value-transfers";
  readonly modality = "chain" as const;
  readonly chains: ChainId[];
  readonly #opts: RpcHunterOptions;
  readonly #guard: PlaneGuard;

  constructor(opts: RpcHunterOptions) {
    if (!(opts.blocks >= 1)) {
      throw new RpcHunterError(`blocks must be at least 1; got ${opts.blocks}`);
    }
    if (!(opts.minNativeValue >= 0)) {
      throw new RpcHunterError(
        `minNativeValue must be non-negative; got ${opts.minNativeValue}`,
      );
    }
    this.#opts = opts;
    this.chains = [opts.chain];
    // Deny-by-default: the guard is built from the closed method list, so
    // adding a method to this class without adding it there fails loudly.
    this.#guard = opts.guard ?? new PlaneGuard("hunt", RPC_HUNT_METHODS);
  }

  /** Every RPC call goes through here, and every call is asserted first. */
  async #send(method: string, params: readonly unknown[]): Promise<unknown> {
    this.#guard.assert(method);
    return this.#opts.fetchJson(method, params);
  }

  async headBlock(): Promise<number> {
    const raw = await this.#send("eth_blockNumber", []);
    if (typeof raw !== "string") {
      throw new RpcHunterError(`eth_blockNumber returned ${typeof raw}`);
    }
    return Number(BigInt(raw));
  }

  async blockAt(height: number): Promise<RpcBlock> {
    const raw = await this.#send("eth_getBlockByNumber", [
      `0x${height.toString(16)}`,
      true,
    ]);
    if (raw === null || typeof raw !== "object") {
      throw new RpcHunterError(`no block at height ${height}`);
    }
    const b = raw as Partial<RpcBlock>;
    if (typeof b.number !== "string" || typeof b.timestamp !== "string") {
      throw new RpcHunterError(`block ${height} is missing number/timestamp`);
    }
    if (!Array.isArray(b.transactions)) {
      throw new RpcHunterError(
        `block ${height} has no transaction array. A block fetched WITHOUT ` +
          "full transaction objects looks like an empty block, which would be " +
          "silently read as 'nothing happened'.",
      );
    }
    return b as RpcBlock;
  }

  async discover(): Promise<Observation[]> {
    const head = await this.headBlock();
    const out = new Map<string, Observation>();
    for (let i = 0; i < this.#opts.blocks; i += 1) {
      const height = head - i;
      if (height < 0) break;
      const block = await this.blockAt(height);
      const observedAt = new Date(Number(BigInt(block.timestamp)) * 1000).toISOString();
      for (const tx of block.transactions) {
        if (!isEoaTransfer(tx)) continue;
        const native = weiToNative(tx.value);
        if (native < this.#opts.minNativeValue) continue;
        const address = tx.from.toLowerCase();
        // One observation per address per run. A wallet that sent four large
        // transfers in one block is one candidate, not four -- counting it
        // four times would inflate every rate computed downstream.
        if (out.has(address)) continue;
        out.set(address, {
          id: `${this.#opts.chain}:${address}:${block.number}`,
          chain: this.#opts.chain,
          address,
          source: this.id,
          observedAt,
          raw: { blockNumber: block.number, txHash: tx.hash, nativeValue: native },
        });
      }
    }
    return [...out.values()];
  }
}

/** The live JSON-RPC transport. Reads only; it cannot construct a write. */
export function httpJsonRpc(endpoint: string, timeoutMs = 20_000): JsonRpcFetch {
  return async (method, params) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new RpcHunterError(`${method} -> HTTP ${res.status}`);
      }
      const body = (await res.json()) as { result?: unknown; error?: unknown };
      if (body.error !== undefined) {
        throw new RpcHunterError(`${method} -> ${JSON.stringify(body.error)}`);
      }
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  };
}
