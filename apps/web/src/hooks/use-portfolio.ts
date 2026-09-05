'use client';

import { useQuery } from '@tanstack/react-query';
import {
  createDreamDexSDK,
  getUserFills,
  getUserPositions,
} from '@followdot/sdk-helpers';
import type { FillRow, OpenPositionPnL } from '@somnia-chain/markets-sdk';
import { useWalletSession } from '@/hooks/use-wallet-session';

export const WALLET_PORTFOLIO_QUERY_KEY = 'wallet-portfolio';

export interface WalletPortfolio {
  positions: OpenPositionPnL[];
  fills: FillRow[];
}

/**
 * Live wallet portfolio for /performance — open positions + fills.
 * Empty indexer/wallet ⇒ empty lists; never mock whale or copy data.
 */
export function useWalletPortfolio() {
  const { hasWalletSession, address } = useWalletSession();

  return useQuery<WalletPortfolio, Error>({
    queryKey: [WALLET_PORTFOLIO_QUERY_KEY, address],
    queryFn: async () => {
      if (!address) throw new Error('Wallet not connected');
      const sdk = createDreamDexSDK({
        restUrl: process.env.NEXT_PUBLIC_DREAMDEX_REST,
        wsUrl: process.env.NEXT_PUBLIC_DREAMDEX_WS,
      });
      const [positions, fills] = await Promise.all([
        getUserPositions(sdk, address),
        getUserFills(sdk, address, 500, 3),
      ]);
      return { positions, fills };
    },
    enabled: hasWalletSession && !!address,
    staleTime: 30_000,
    retry: 1,
  });
}
