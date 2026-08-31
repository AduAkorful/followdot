import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWalletClient, useAccount } from "wagmi";
import { placeCopyOrder } from "@followdot/sdk-helpers";
import type { BinarySide } from "@somnia-chain/markets-sdk";

export interface CopyOrderParams {
  pool: string;
  whaleSide: BinarySide;
  stake: bigint;
  slippageBps?: number;
}

export function useCopyOrder() {
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();
  const queryClient = useQueryClient();

  return useMutation<{ hash: string; orderId: string }, Error, CopyOrderParams>({
    mutationFn: async (params) => {
      if (!walletClient || !address) {
        throw new Error("Wallet not connected");
      }
      return placeCopyOrder(
        { walletClient },
        params.pool,
        params.whaleSide,
        params.stake,
        params.slippageBps,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whale-profile"] });
    },
  });
}
