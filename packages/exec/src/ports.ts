import type { Amount, AssetRef, VenueId } from "@hydra/core";
import type { Result } from "@hydra/core";

export type ExecError = string;

export interface TradeRequest {
  clientOrderId: string;
  venue: VenueId;
  side: "buy" | "sell";
  inputAsset: AssetRef;
  outputAsset: AssetRef;
  amount: Amount;
  amountMode: "exact_in" | "exact_out";
  slippageBps: number;
  maxImpactBps: number;
  urgency: "low" | "normal" | "high";
  deadlineSec: number;
  dryRun: boolean;
  origin: {
    type: "manual" | "limit_watch" | "copy" | "research";
    walletId?: string;
    observationId?: string;
    conviction: number;
  };
}

export interface Quote {
  venue: VenueId;
  inputAsset: AssetRef;
  outputAsset: AssetRef;
  inputAmount: Amount;
  expectedOutput: Amount;
  minOutput: Amount;
  priceImpactBps: number;
  gasEstimate?: Amount;
  validUntil: number;
  routeId?: string;
}

export interface SimulateResult {
  ok: boolean;
  expectedOutput?: Amount;
  minOutput?: Amount;
  priceImpactBps?: number;
  gasEstimate?: Amount;
  error?: string;
}

export interface ExecutionReceipt {
  clientOrderId: string;
  venue: VenueId;
  status: "submitted" | "confirmed" | "failed";
  txHash?: string;
  fillAmount?: Amount;
}

export interface VenueBalance {
  asset: AssetRef;
  free: Amount;
  locked: Amount;
}

/**
 * Venue adapter contract.
 *
 * Exec adapters own the mechanics of quote, simulation, execution,
 * confirmation, and balances for one venue. They never import Agent-Reach or
 * Browser Use. Hunting intelligence must never enter the execution path.
 */
export interface VenueAdapter {
  venue: VenueId;
  quote(request: TradeRequest): Promise<Result<Quote, ExecError>>;
  simulate(request: TradeRequest): Promise<Result<SimulateResult, ExecError>>;
  execute(request: TradeRequest): Promise<Result<ExecutionReceipt, ExecError>>;
  confirm(clientOrderId: string): Promise<Result<ExecutionReceipt, ExecError>>;
  balances(assets: AssetRef[]): Promise<Result<VenueBalance[], ExecError>>;
}
