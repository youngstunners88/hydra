/**
 * Read-only chain access for resolving outcomes, behind a PlaneGuard.
 *
 * Three JSON-RPC methods, all reads. The resolver needs one more than the
 * hunter -- `eth_getBalance` at a historical block -- and gets its own closed
 * allowlist rather than widening the hunter's. Each consumer states the exact
 * surface it uses.
 *
 * Historical balances need an archive node. Probed 2026-09-23 against
 * rpc.pulsechain.com: balances 100, 20,000 and 500,000 blocks back all
 * answered. If an endpoint stops serving archive state, reads raise and the
 * decision stays UNREADABLE -- it is never resolved on a guess.
 */

import { PlaneGuard } from "@hydra/risk/planeGuard.ts";
import type { JsonRpcFetch } from "../sources/rpcHunter.ts";

export const RESOLVE_METHODS: readonly string[] = [
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBalance",
];

export class ChainReadError extends Error {}

export interface BlockHeader {
  readonly number: number;
  /** Unix seconds. */
  readonly timestamp: number;
}

export interface ChainReader {
  head(): Promise<BlockHeader>;
  header(height: number): Promise<BlockHeader>;
  balanceAt(address: string, height: number): Promise<bigint>;
}

const hex = (n: number) => `0x${n.toString(16)}`;

function parseQuantity(raw: unknown, what: string): bigint {
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw)) {
    throw new ChainReadError(`${what}: not a hex quantity: ${JSON.stringify(raw)}`);
  }
  return BigInt(raw);
}

export class RpcChainReader implements ChainReader {
  readonly #fetch: JsonRpcFetch;
  readonly #guard: PlaneGuard;

  constructor(fetchJson: JsonRpcFetch, guard?: PlaneGuard) {
    this.#fetch = fetchJson;
    this.#guard = guard ?? new PlaneGuard("hunt", RESOLVE_METHODS);
  }

  async #send(method: string, params: readonly unknown[]): Promise<unknown> {
    this.#guard.assert(method);
    return this.#fetch(method, params);
  }

  async header(height: number): Promise<BlockHeader> {
    // `false`: header only. Resolution never needs transaction bodies, and
    // asking for them would multiply the bytes per binary-search step.
    const raw = await this.#send("eth_getBlockByNumber", [hex(height), false]);
    if (raw === null || typeof raw !== "object") {
      throw new ChainReadError(`no block at height ${height}`);
    }
    const b = raw as { number?: unknown; timestamp?: unknown };
    return {
      number: Number(parseQuantity(b.number, `block ${height} number`)),
      timestamp: Number(parseQuantity(b.timestamp, `block ${height} timestamp`)),
    };
  }

  async head(): Promise<BlockHeader> {
    const raw = await this.#send("eth_blockNumber", []);
    return this.header(Number(parseQuantity(raw, "eth_blockNumber")));
  }

  async balanceAt(address: string, height: number): Promise<bigint> {
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      throw new ChainReadError(`not a lowercase 20-byte address: ${address}`);
    }
    const raw = await this.#send("eth_getBalance", [address, hex(height)]);
    return parseQuantity(raw, `balance of ${address} at ${height}`);
  }
}

/**
 * The latest block whose timestamp is <= `unixSeconds`.
 *
 * Binary search over headers: ~25 reads for a chain of tens of millions of
 * blocks. "Latest block at or before" rather than "nearest", because the
 * nearest block can be one mined AFTER the moment in question -- and reading
 * state from after a decision is exactly the look-ahead this rule must not
 * contain.
 */
export async function blockAtOrBefore(
  reader: ChainReader,
  unixSeconds: number,
  head?: BlockHeader,
): Promise<BlockHeader> {
  const top = head ?? (await reader.head());
  if (unixSeconds >= top.timestamp) return top;

  const genesis = await reader.header(0);
  if (unixSeconds < genesis.timestamp) {
    throw new ChainReadError(
      `time ${unixSeconds} precedes genesis (${genesis.timestamp}); no block exists`,
    );
  }

  // Invariant: lo.timestamp <= t < hi.timestamp.
  let lo = genesis;
  let hi = top;
  while (hi.number - lo.number > 1) {
    const mid = await reader.header(Math.floor((lo.number + hi.number) / 2));
    if (mid.timestamp <= unixSeconds) lo = mid;
    else hi = mid;
  }
  return lo;
}
