import type { ChainId, HuntContext, Observation } from "@hydra/core";

/**
 * A composable hunter. One implementation file per strategy.
 *
 * Hunters never sign transactions. Their output is only raw public
 * observation data that can later enter the lifecycle pipeline.
 */
export interface Hunter {
  id: string;
  modality: "api" | "social" | "browser" | "chain";
  chains: ChainId[];
  discover(ctx: HuntContext): Promise<Observation[]>;
}
