/**
 * Client-side DreamDEX session-key grant.
 *
 * 1. Generate an ephemeral private key (viem).
 * 2. Ask the connected wallet (MetaMask / Privy) to call
 *    OperatorPermissionsRegistry.setOperatorApprovalGlobal via the SDK trader,
 *    admitting PLACE_ORDER_FOR + CANCEL_ORDER_FOR for that ephemeral address.
 * 3. Caller POSTs the key material to /api/auth-session-key for local persistence.
 */

import {
  SomniaMarkets,
  SOMNIA_TESTNET_ADDRESSES,
  PLACE_ORDER_FOR_SELECTOR,
  CANCEL_ORDER_FOR_SELECTOR,
} from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex, WalletClient } from "viem";
import { INDEXER_URL, OPERATOR_PERMISSIONS_REGISTRY } from "@/config/somnia";

export const SESSION_SELECTORS = [
  PLACE_ORDER_FOR_SELECTOR,
  CANCEL_ORDER_FOR_SELECTOR,
] as const;

export interface GeneratedSessionKey {
  privateKey: Hex;
  address: Address;
}

export interface GrantSessionKeyResult {
  privateKey: Hex;
  address: Address;
  grantTxHash: Hex | null;
  onChainGranted: boolean;
}

export function generateEphemeralSessionKey(): GeneratedSessionKey {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

function requireIndexerUrl(): string {
  if (!INDEXER_URL?.trim()) {
    throw new Error("NEXT_PUBLIC_DREAMDEX_REST is not configured");
  }
  return INDEXER_URL;
}

function createSdk() {
  return new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: requireIndexerUrl(),
    wsRpcUrl: process.env.NEXT_PUBLIC_DREAMDEX_WS,
    addresses: {
      ...SOMNIA_TESTNET_ADDRESSES,
      operatorPermissionsRegistry: OPERATOR_PERMISSIONS_REGISTRY,
    },
  });
}

/**
 * Prompt the user wallet to grant (or revoke) on-chain operator approval for
 * `operator` across registered pools.
 */
export async function setSessionOperatorApproval(opts: {
  walletClient: WalletClient;
  operator: Address;
  approved: boolean;
}): Promise<Hex> {
  if (!opts.walletClient.account) {
    throw new Error("Wallet client has no account");
  }

  const sdk = createSdk();
  const trader = sdk.client.createTrader({ walletClient: opts.walletClient });
  const result = await trader.setOperatorApprovalGlobal({
    operator: opts.operator,
    selectors: [...SESSION_SELECTORS],
    approved: opts.approved,
    operatorRegistry: OPERATOR_PERMISSIONS_REGISTRY,
  });
  return result.hash as Hex;
}

/**
 * Full grant path: mint ephemeral key → MetaMask/on-chain approval → return material.
 * Does not persist; caller must POST to /api/auth-session-key.
 */
export async function grantDreamDexSessionKey(opts: {
  walletClient: WalletClient;
  /** When true, skip on-chain grant (local-only key material). Default false. */
  skipOnChain?: boolean;
}): Promise<GrantSessionKeyResult> {
  const generated = generateEphemeralSessionKey();

  if (opts.skipOnChain) {
    return {
      privateKey: generated.privateKey,
      address: generated.address,
      grantTxHash: null,
      onChainGranted: false,
    };
  }

  const grantTxHash = await setSessionOperatorApproval({
    walletClient: opts.walletClient,
    operator: generated.address,
    approved: true,
  });

  return {
    privateKey: generated.privateKey,
    address: generated.address,
    grantTxHash,
    onChainGranted: true,
  };
}

export function classifySessionKeyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("rejected the request") ||
    lower.includes("denied transaction") ||
    lower.includes("action_rejected")
  ) {
    return "Wallet rejected the DreamDEX operator approval transaction.";
  }

  if (lower.includes("authorization endpoint") || lower.includes("404")) {
    return "Session-key API is missing. Restart the Next.js app after pulling latest.";
  }

  if (lower.includes("not configured") || lower.includes("operatorpermission")) {
    return `On-chain grant failed: ${message}`;
  }

  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return "Network error talking to the session-key API or RPC. Check connectivity.";
  }

  return message || "Session-key authorization failed.";
}
