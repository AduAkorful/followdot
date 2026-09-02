import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import type { Chain } from "viem";

/**
 * Somnia Shannon testnet (chain 50312).
 *
 * Uses the SDK's own chain definition which includes WebSocket RPC URLs
 * (viem's `somniaTestnet` lacks a ws endpoint, which the SDK requires).
 */
export const somniaChain: Chain = somniaShannon;

export const INDEXER_URL =
  process.env.NEXT_PUBLIC_DREAMDEX_REST as string;

export default somniaChain;
