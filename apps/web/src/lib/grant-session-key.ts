/**
 * Client-side DreamDEX session-key grant.
 *
 * 1. Generate an ephemeral private key (viem).
 * 2. Ask the connected wallet (MetaMask / Privy) to call
 *    OperatorPermissionsRegistry.setOperatorApprovalGlobal once, admitting
 *    PLACE_ORDER_FOR + CANCEL_ORDER_FOR for that ephemeral address.
 * 3. Caller POSTs the key material to /api/auth-session-key for local persistence.
 *
 * IMPORTANT: Do NOT route the browser grant through markets-sdk `createTrader().
 * setOperatorApprovalGlobal()`. That path waits forever on WebSocket `newHeads`
 * receipt confirmation (`waitReceiptViaHeads` has no timeout). Live E2E saw
 * MetaMask approvals succeed while the UI stayed on “Authorizing…” and never
 * POSTed /api/auth-session-key — retries then produced duplicate on-chain grants.
 * We writeContract directly and treat the returned tx hash as success for register.
 */

import {
  PLACE_ORDER_FOR_SELECTOR,
  CANCEL_ORDER_FOR_SELECTOR,
} from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseAbi, type Address, type Hex, type WalletClient } from "viem";
import { OPERATOR_PERMISSIONS_REGISTRY } from "@/config/somnia";

export const SESSION_SELECTORS = [
  PLACE_ORDER_FOR_SELECTOR,
  CANCEL_ORDER_FOR_SELECTOR,
] as const;

/** Minimal write ABI — one tx grants/revokes every selector in the array. */
export const OPERATOR_REGISTRY_WRITE_ABI = parseAbi([
  "function setOperatorApprovalGlobal(address operator, bytes4[] selectors, bool approved)",
]);

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

export interface RegisterSessionKeyBody {
  walletAddress: string;
  sessionAddress: string;
  sessionKey: string;
  grantTxHash?: string | null;
  onChainGranted: boolean;
}

export interface RegisterSessionKeyResult {
  active: boolean;
  address?: string;
  sessionAddress: string | null;
  grantTxHash: string | null;
  onChainGranted: boolean;
  workerNote?: string;
}

export function generateEphemeralSessionKey(): GeneratedSessionKey {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

/**
 * Prompt the user wallet to grant (or revoke) on-chain operator approval for
 * `operator` across registered pools — a single setOperatorApprovalGlobal tx.
 */
export async function setSessionOperatorApproval(opts: {
  walletClient: WalletClient;
  operator: Address;
  approved: boolean;
}): Promise<Hex> {
  if (!opts.walletClient.account) {
    throw new Error("Wallet client has no account");
  }

  const chain = opts.walletClient.chain ?? somniaShannon;
  const hash = await opts.walletClient.writeContract({
    address: OPERATOR_PERMISSIONS_REGISTRY,
    abi: OPERATOR_REGISTRY_WRITE_ABI,
    functionName: "setOperatorApprovalGlobal",
    args: [opts.operator, [...SESSION_SELECTORS], opts.approved],
    account: opts.walletClient.account,
    chain,
  });

  return hash as Hex;
}

/**
 * Full grant path: mint ephemeral key → MetaMask/on-chain approval → return material.
 * Does not persist; caller must POST to /api/auth-session-key via registerSessionKey.
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

/**
 * POST ephemeral key material to the local auth-session-key API.
 * Always sends x-wallet-address (required by the route for GET/DELETE; POST uses body).
 */
export async function registerSessionKey(
  walletAddress: string,
  body: RegisterSessionKeyBody,
): Promise<RegisterSessionKeyResult> {
  const res = await fetch("/api/auth-session-key", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-wallet-address": walletAddress,
    },
    body: JSON.stringify({
      walletAddress: body.walletAddress,
      sessionAddress: body.sessionAddress,
      sessionKey: body.sessionKey,
      // Compat aliases some callers use for the ephemeral key
      address: body.sessionAddress,
      privateKey: body.sessionKey,
      grantTxHash: body.grantTxHash ?? null,
      onChainGranted: body.onChainGranted,
    }),
  });

  if (res.status === 404) {
    throw new Error("Authorization endpoint not available (404)");
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(
      errBody?.error ??
        `Registration failed (${res.status}). On-chain grant may have succeeded — check MetaMask activity.`,
    );
  }

  return (await res.json()) as RegisterSessionKeyResult;
}

/** GET public session status — always pass wallet via query + header. */
export async function fetchSessionKeyStatus(walletAddress: string): Promise<RegisterSessionKeyResult & {
  active: boolean;
  workerNote?: string;
}> {
  const res = await fetch(
    `/api/auth-session-key?wallet=${encodeURIComponent(walletAddress)}`,
    { headers: { "x-wallet-address": walletAddress } },
  );

  if (res.status === 404) {
    throw new Error("Authorization endpoint not available (404)");
  }
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errBody?.error ?? `Failed to load session status (${res.status})`);
  }

  return (await res.json()) as RegisterSessionKeyResult & { active: boolean; workerNote?: string };
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

  if (
    lower.includes("durable backend") ||
    lower.includes("session-key store has no durable") ||
    lower.includes("upstash") ||
    lower.includes("cloudflare kv") ||
    lower.includes("vercel serverless")
  ) {
    return message;
  }

  if (
    lower.includes("registration failed") ||
    lower.includes("on-chain grant may have succeeded")
  ) {
    return message;
  }

  if (lower.includes("not configured") || lower.includes("operatorpermission")) {
    return `On-chain grant failed: ${message}`;
  }

  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return "Network error talking to the session-key API or RPC. Check connectivity.";
  }

  return message || "Session-key authorization failed.";
}
