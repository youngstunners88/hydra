/**
 * The chain-read PORT the resolver needs, owned by the consumer.
 *
 * Dependency inversion, applied literally: the decision plane states the
 * three reads it requires and nothing more. The hunt plane's RpcChainReader
 * satisfies this interface STRUCTURALLY -- it does not import this file, so
 * `hunter` never depends on `decide` and `decide` never depends on `hunter`.
 * The control plane (scripts/) is the only place the two meet.
 */

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

/**
 * The latest block whose timestamp is <= `unixSeconds`.
 *
 * Binary search over headers: ~25 reads for a chain of tens of millions of
 * blocks. "Latest block at or before" rather than "nearest", because the
 * nearest block can be one mined AFTER the moment in question -- and reading
 * state from after a decision is exactly the look-ahead the resolution rule
 * must not contain.
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

/**
 * Memoises reads, as a decorator over any ChainReader.
 *
 * The experiment records up to three arms per wallet at nearly the same
 * moment, and resolving each arm repeats the same balance reads and the same
 * ~25-step block search. Historical state at a fixed height never changes, so
 * caching it is exact, not approximate. `head()` is NOT cached: it is the one
 * read whose answer is supposed to move.
 */
export class CachedChainReader implements ChainReader {
  readonly #inner: ChainReader;
  readonly #headers = new Map<number, Promise<BlockHeader>>();
  readonly #balances = new Map<string, Promise<bigint>>();
  reads = 0;

  constructor(inner: ChainReader) {
    this.#inner = inner;
  }

  head(): Promise<BlockHeader> {
    this.reads += 1;
    return this.#inner.head();
  }

  header(height: number): Promise<BlockHeader> {
    let p = this.#headers.get(height);
    if (!p) {
      this.reads += 1;
      p = this.#inner.header(height);
      // A failed read must not be cached, or one transient error would make
      // that height permanently unreadable for the rest of the run.
      p.catch(() => this.#headers.delete(height));
      this.#headers.set(height, p);
    }
    return p;
  }

  balanceAt(address: string, height: number): Promise<bigint> {
    const k = `${address}@${height}`;
    let p = this.#balances.get(k);
    if (!p) {
      this.reads += 1;
      p = this.#inner.balanceAt(address, height);
      p.catch(() => this.#balances.delete(k));
      this.#balances.set(k, p);
    }
    return p;
  }
}
