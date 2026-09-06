import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount, useWalletClient } from 'wagmi';
import { closeOpenPosition } from '@followdot/sdk-helpers';
import type { BinarySellSide } from '@somnia-chain/markets-sdk';
import { WALLET_PORTFOLIO_QUERY_KEY } from '@/hooks/use-portfolio';

export interface ClosePositionParams {
  pool: string;
  side: BinarySellSide;
  quantity: bigint;
  quoteDecimals: number;
  slippageBps?: number;
}

/**
 * Live DreamDEX market sell to unwind a full YES/NO balance for Manage → Close.
 */
export function useClosePosition() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: ClosePositionParams) => {
      if (!isConnected || !address) throw new Error('Wallet not connected');
      if (!walletClient) throw new Error('Wallet client unavailable. Reconnect and try again.');
      return closeOpenPosition(
        {
          walletClient,
          restUrl: process.env.NEXT_PUBLIC_DREAMDEX_REST,
          wsUrl: process.env.NEXT_PUBLIC_DREAMDEX_WS,
        },
        params,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [WALLET_PORTFOLIO_QUERY_KEY] });
    },
  });
}
