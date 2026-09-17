import type { Amount, AssetRef, VenueId } from "@hydra/core";
import type { Result } from "@hydra/core";

export type RiskError = string;
export type RiskApprovalMode = "exact" | "infinite";

export interface RiskPolicy {
  maxDailyUsd: Amount;
  maxDailyLossUsd: Amount;
  maxTokenUsd: Amount;
  maxCopyFractionOfWallet: number;
  allowUnknownTokens: boolean;
  approvalMode: RiskApprovalMode;
}

export interface RiskCounters {
  dailyNotionalUsd: Amount;
  dailyLossUsd: Amount;
  tokenExposureUsd: Amount;
  copyFractionOfWallet: number;
  copyWalletTotalUsd: Amount;
  currentCopyWallets: number;
  maxCopyWallets: number;
}

export interface RiskOrderRequest {
  clientOrderId: string;
  venue: VenueId;
  side: "buy" | "sell";
  inputAsset: AssetRef;
  outputAsset: AssetRef;
  amount: Amount;
  estimatedNotionalUsd: Amount;
  knownToken: boolean;
  origin: {
    type: "manual" | "limit_watch" | "copy" | "research";
    walletId?: string;
    observationId?: string;
    conviction: number;
  };
}

export interface RiskDecision {
  allowed: boolean;
  vetoes: string[];
  warnings: string[];
}

/**
 * Risk port for pre-trade checks.
 *
 * The implementation uses the risk config subsection, current counters, and
 * the proposed order to return a deterministic veto/allow decision. It must
 * not reach into hunter or execution adapters.
 */
export interface RiskPort {
  checkOrder(
    request: RiskOrderRequest,
    counters: RiskCounters,
  ): Result<RiskDecision, RiskError>;
}
