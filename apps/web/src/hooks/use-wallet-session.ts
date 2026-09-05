'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useAccount } from 'wagmi';
import { somniaChain } from '@/config/somnia';

/**
 * Real wallet session gate — Privy-only / missing address must not look connected.
 * Align ConnectButton + Topbar network pill on the same predicate.
 */
export function useWalletSession() {
  const { authenticated, ready, user } = usePrivy();
  const { isConnected, address, chain } = useAccount();

  const privyWallet = user?.wallet?.address;
  const addressesAligned =
    !privyWallet ||
    !address ||
    privyWallet.toLowerCase() === address.toLowerCase();

  const hasWalletSession =
    ready && authenticated && isConnected && !!address && addressesAligned;

  const isWrongNetwork =
    hasWalletSession && chain?.id !== somniaChain.id;

  return {
    ready,
    authenticated,
    hasWalletSession,
    address: hasWalletSession ? address : undefined,
    chain,
    isWrongNetwork,
    isConnected,
  };
}
