import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { getClaimablePositions, redeemAll, createDreamDexSDK } from "@followdot/sdk-helpers";
import type { ClaimablePosition } from "@somnia-chain/markets-sdk";

export const CLAIMABLE_QUERY_KEY = "claimable-positions";

export function useClaimablePositions() {
  const { address } = useAccount();
  return useQuery<ClaimablePosition[], Error>({
    queryKey: [CLAIMABLE_QUERY_KEY, address],
    queryFn: async () => {
      if (!address) throw new Error("Wallet not connected");
      const sdk = createDreamDexSDK();
      return getClaimablePositions(sdk, address);
    },
    enabled: !!address,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useClaimWinnings() {
  const { address } = useAccount();
  const queryClient = useQueryClient();

  return useMutation<{ hash: string }, Error, { entries: ClaimablePosition[] }>({
    mutationFn: async ({ entries }) => {
      if (!address) throw new Error("Wallet not connected");
      if (entries.length === 0) throw new Error("No claimable positions");
      const sdk = createDreamDexSDK();
      const result = await redeemAll(sdk, entries);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CLAIMABLE_QUERY_KEY] });
    },
  });
}
