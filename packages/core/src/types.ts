/**
 * Core Hydra types.
 *
 * This package must not import anything in-repo. It is the shared spine for
 * every other Hydra package.
 */

export type ChainId =
  | "solana"
  | "ethereum"
  | "bsc"
  | "8453"
  | "4663"
  | "369"
  | "46630";

export type VenueId =
  | "solana"
  | "base"
  | "robinhood_chain"
  | "pulsechain"
  | "robinhood_crypto";

/**
 * Decimal-safe monetary amount. Always a decimal string such as "0.05",
 * "1234.5678". Never a raw JS float at interface boundaries meant to carry
 * money.
 */
export type Amount = string & { readonly __brand: "Amount" };

export const toAmount = (value: string): Amount => value as Amount;

export const amountToString = (value: Amount): string => value;

export interface AssetRef {
  chain: ChainId;
  /** Short symbol if known, e.g. "SOL" or "WPLS". */
  symbol?: string;
  /** On-chain token address for EVM or SPL mint for Solana. */
  address?: string;
}

export type HealthStatus = "ok" | "degraded" | "down";

/**
 * A raw public on-chain observation from a hunter. It must carry at least a
 * validated public address and a chain before it can become a candidate.
 */
export interface Observation {
  id: string;
  chain: ChainId;
  address: string;
  source: string;
  observedAt: string;
  confidence?: number;
  raw?: unknown;
}

export interface HuntContext {
  chain?: ChainId;
  limit?: number;
  sources?: string[];
  minScore?: number;
}

export interface PageDoc {
  url: string;
  title?: string;
  text: string;
  capturedAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * A public wallet mention extracted from social/web content by Agent-Reach.
 *
 * Hydra stores public addresses and public handles only. Extracted values
 * that look like emails, phone numbers, home addresses, or government IDs
 * must be discarded by the extractor.
 */
export interface WalletMention {
  address: string;
  chain?: ChainId;
  source: string;
  context: string;
  mentionedAt: string;
  certainty: "low" | "medium" | "high";
}
