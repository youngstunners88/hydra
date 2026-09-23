/**
 * Read-only chain access (hunt-plane ADAPTER) for the decision plane's
 * ChainReader port, behind a PlaneGuard.
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

import { PlaneGuard } from "@hydra/core/planeGuard.ts";
import type { JsonRpcFetch } from "./rpcHunter.ts";

export const RESOLVE_METHODS: readonly string[] = [
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBalance",
];

export class ChainReadError extends Error {}

/** Structurally identical to decide's BlockHeader; declared here so the hunt
 *  plane does not import the decision plane. The control plane's typecheck is
 *  what proves the two agree -- it passes this adapter where the port is due. */
export interface BlockHeader {
  readonly number: number;
  readonly timestamp: number;
}

const hex = (n: number) => `0x${n.toString(16)}`;

function parseQuantity(raw: unknown, what: string): bigint {
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw)) {
    throw new ChainReadError(`${what}: not a hex quantity: ${JSON.stringify(raw)}`);
  }
  return BigInt(raw);
}

export class RpcChainReader {
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
