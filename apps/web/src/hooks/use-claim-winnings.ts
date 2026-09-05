import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useWalletClient } from "wagmi";
import { getClaimablePositions, redeemAll, createDreamDexSDK } from "@followdot/sdk-helpers";
import type { ClaimablePosition } from "@somnia-chain/markets-sdk";
import { resolveClaimQuoteDecimalsMap } from "@/lib/claim-decimals";

export const CLAIMABLE_QUERY_KEY = "claimable-positions";

/** Claimable row enriched with market/token decimals for honest payout formatting. */
export type ClaimablePositionView = ClaimablePosition & {
  quoteDecimals: number | null;
};

export function useClaimablePositions() {
  const { address, isConnected } = useAccount();
  return useQuery<ClaimablePositionView[], Error>({
    queryKey: [CLAIMABLE_QUERY_KEY, address],
    queryFn: async () => {
      if (!address) throw new Error("Wallet not connected");
      const sdk = createDreamDexSDK({
        restUrl: process.env.NEXT_PUBLIC_DREAMDEX_REST,
        wsUrl: process.env.NEXT_PUBLIC_DREAMDEX_WS,
      });
      // Live getClaimable only — empty indexer/wallet means empty list, never mocks.
      const positions = await getClaimablePositions(sdk, address);
      const decimalsByMarket = await resolveClaimQuoteDecimalsMap(
        sdk,
        positions.map((p) => p.marketId),
      );
      return positions.map((p) => ({
        ...p,
        quoteDecimals: decimalsByMarket[p.marketId.toLowerCase()] ?? null,
      }));
    },
    enabled: isConnected && !!address,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useClaimWinnings() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();

  return useMutation<{ hash: string }, Error, { entries: ClaimablePosition[] }>({
    mutationFn: async ({ entries }) => {
      if (!isConnected || !address) throw new Error("Wallet not connected");
      if (!walletClient) throw new Error("Wallet client unavailable");
      if (entries.length === 0) throw new Error("No claimable positions");
      const sdk = createDreamDexSDK({
        restUrl: process.env.NEXT_PUBLIC_DREAMDEX_REST,
        wsUrl: process.env.NEXT_PUBLIC_DREAMDEX_WS,
      });
      const result = await redeemAll(sdk, entries, { walletClient });
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CLAIMABLE_QUERY_KEY] });
    },
  });
}
