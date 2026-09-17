import type { Amount, HealthStatus, Observation, VenueId } from "./types.js";

/**
 * Hydra's append-only event envelope.
 *
 * Every event has an id, an ISO timestamp, the event type, and a payload.
 * Projections rebuild from these events; no mutable god object.
 */
export interface HydraEventEnvelope<
  Type extends string,
  Payload extends Record<string, unknown>,
> {
  id: string;
  ts: string;
  type: Type;
  payload: Payload;
}

export type HydraEvent =
  | HydraEventEnvelope<"ObservationIngested", { observation: Observation }>
  | HydraEventEnvelope<
      "WalletScored",
      {
        walletId: string;
        composite: number;
        copyTradeable: 0 | 1;
        reasons: string[];
        vetoes: string[];
      }
    >
  | HydraEventEnvelope<
      "WalletPromoted",
      { walletId: string; from: string; to: string; reason: string }
    >
  | HydraEventEnvelope<"WalletRetired", { walletId: string; reason: string }>
  | HydraEventEnvelope<
      "QuoteTaken",
      {
        venue: VenueId;
        inputAsset: string;
        outputAsset: string;
        amount: Amount;
        expectedOut?: Amount;
        validUntil?: string;
      }
    >
  | HydraEventEnvelope<
      "OrderIntent",
      {
        clientOrderId: string;
        venue: VenueId;
        side: "buy" | "sell";
        inputAsset: string;
        outputAsset: string;
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
    >
  | HydraEventEnvelope<
      "OrderSubmitted",
      { clientOrderId: string; venue: VenueId; txHash?: string }
    >
  | HydraEventEnvelope<
      "OrderConfirmed",
      { clientOrderId: string; venue: VenueId; txHash: string; fillAmount?: Amount }
    >
  | HydraEventEnvelope<
      "OrderFailed",
      { clientOrderId: string; venue: VenueId; reason: string }
    >
  | HydraEventEnvelope<
      "RiskVeto",
      { clientOrderId?: string; venue?: VenueId; reason: string }
    >
  | HydraEventEnvelope<
      "KillSwitchFlipped",
      { active: boolean; reason: string }
    >
  | HydraEventEnvelope<
      "IntelDegraded",
      { source: string; status: HealthStatus; reason?: string }
    >;
