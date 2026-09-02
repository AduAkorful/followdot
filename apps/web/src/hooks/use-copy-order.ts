import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletClient, useAccount } from "wagmi";
import { placeCopyOrder } from "@followdot/sdk-helpers";
import { checkMarketHealth, type MarketHealth } from "@/lib/dreamdex";
import type { BinarySide } from "@somnia-chain/markets-sdk";
import { parseUnits } from "viem";

export interface CopyOrderParams {
  pool: string;
  marketId?: string;
  whaleAddress?: string;
  whaleSide: BinarySide;
  stakeHuman: number;
  exposureCap: number | null;
  slippageBps?: number;
}

/**
 * Mutation hook for placing a one-click copy order.
 *
 * Before submitting the order, runs all pre-trade risk gates (F6) when a
 * marketId is available. If any gate is "block", the mutation throws with
 * the blocker descriptions — the caller (modal) is expected to show these
 * in its Risk Check section.
 */
export function useCopyOrder() {
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();
  const queryClient = useQueryClient();

  return useMutation<{ hash: string; orderId: string; health?: MarketHealth }, Error, CopyOrderParams>({
    mutationFn: async (params) => {
      if (!walletClient || !address) {
        throw new Error("Wallet not connected");
      }

      if (!params.marketId) {
        throw new Error("Live market context unavailable; refusing to place order");
      }

      const health = await checkMarketHealth({
        marketId: params.marketId,
        marketAddress: params.pool,
        userAddress: address,
        whaleAddress: params.whaleAddress ?? null,
        stakeHuman: params.stakeHuman,
        exposureCap: params.exposureCap,
      });

      if (!health.canProceed) {
        const blockers = health.gates.filter((g) => g.status === "block");
        throw new Error(
          `Risk check failed: ${blockers.map((g) => `${g.label} — ${g.detail}`).join("; ")}`,
        );
      }

      if (health.collateralDecimals === null) {
        throw new Error("Collateral decimals unavailable; refusing to place order");
      }
      const decimals = health.collateralDecimals;
      const stake = parseUnits(params.stakeHuman.toFixed(decimals), decimals);

      const result = await placeCopyOrder(
        {
          walletClient,
          restUrl: process.env.NEXT_PUBLIC_DREAMDEX_REST,
          wsUrl: process.env.NEXT_PUBLIC_DREAMDEX_WS,
        },
        params.pool,
        params.whaleSide,
        stake,
        params.slippageBps,
      );

      return { ...result, health };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whale-profile"] });
    },
  });
}

/**
 * Query hook for pre-trade risk gates (F6).
 *
 * Fetches market health for display in the CopyOrderModal's Risk Check section.
 * Re-evaluates when the stake or market changes.
 */
export function useRiskCheck(params: {
  marketId?: string;
  pool?: string;
  whaleAddress?: string;
  stakeHuman: number;
  exposureCap: number | null;
}) {
  const { address } = useAccount();
  const marketId = params.marketId ?? "";
  const pool = params.pool ?? "";

  return useQuery({
    queryKey: ["risk-check", marketId, params.stakeHuman, params.exposureCap, address],
    queryFn: () =>
      checkMarketHealth({
        marketId,
        marketAddress: pool,
        userAddress: address ?? "",
        whaleAddress: params.whaleAddress ?? null,
        stakeHuman: params.stakeHuman,
        exposureCap: params.exposureCap,
      }),
    enabled: Boolean(marketId && pool && address),
    staleTime: 30_000,
    retry: 1,
    retryDelay: 2_000,
  });
}
