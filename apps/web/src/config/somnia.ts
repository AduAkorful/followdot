import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import type { Address, Chain } from "viem";

/**
 * Somnia Shannon testnet (chain 50312).
 *
 * Uses the SDK's own chain definition which includes WebSocket RPC URLs
 * (viem's `somniaTestnet` lacks a ws endpoint, which the SDK requires).
 */
export const somniaChain: Chain = somniaShannon;

export const INDEXER_URL =
  process.env.NEXT_PUBLIC_DREAMDEX_REST as string;

/**
 * DreamDEX OperatorPermissionsRegistry on Shannon testnet (chain 50312).
 * Source: https://app.dreamdex.io/docs/developers/contracts/contract-addresses
 *
 * Not yet baked into `@somnia-chain/markets-sdk` SOMNIA_TESTNET_ADDRESSES;
 * pass explicitly when calling setOperatorApprovalGlobal / isGloballyApproved.
 */
export const OPERATOR_PERMISSIONS_REGISTRY =
  "0x15C7e8CE38F021c5b45d098AaD788f63090bF20A" as Address;

export default somniaChain;
