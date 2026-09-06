import { NextRequest, NextResponse } from "next/server";
import {
  deleteSessionKey,
  durableBackendConfigured,
  getSessionKey,
  isAddress,
  isPrivateKey,
  isVercelRuntimeHint,
  putSessionKey,
  resolveSessionKeyBackend,
  SessionKeyPersistError,
  toPublicView,
} from "@/lib/session-key-store";

export const dynamic = "force-dynamic";

function walletFrom(request: NextRequest, bodyWallet?: string): string | null {
  const header = request.headers.get("x-wallet-address")?.trim();
  const query = request.nextUrl.searchParams.get("wallet")?.trim();
  const candidate = header || bodyWallet || query || "";
  return isAddress(candidate) ? candidate : null;
}

function inactivePayload(wallet: string) {
  const backend = resolveSessionKeyBackend();
  return {
    active: false,
    walletAddress: wallet.toLowerCase(),
    sessionAddress: null,
    grantTxHash: null,
    onChainGranted: false,
    storeBackend: backend,
    workerNote:
      backend === "file" && isVercelRuntimeHint() && !durableBackendConfigured()
        ? "No durable session-key store configured on this host (Vercel serverless). Authorize will fail until KV_REST_API_URL+KV_REST_API_TOKEN or CF_ACCOUNT_ID+CF_API_TOKEN+CF_KV_NAMESPACE_ID are set."
        : "No session key registered. Authorize to generate an ephemeral key and grant OperatorPermissionsRegistry place/cancel selectors.",
  };
}

/**
 * GET /api/auth-session-key?wallet=0x…  (or x-wallet-address header)
 * Returns public session status — never the private key.
 */
export async function GET(request: NextRequest) {
  const wallet = walletFrom(request);
  if (!wallet) {
    return NextResponse.json(
      { error: "wallet address required (x-wallet-address or ?wallet=)" },
      { status: 400 },
    );
  }

  try {
    const record = await getSessionKey(wallet);
    if (!record) {
      return NextResponse.json(inactivePayload(wallet));
    }
    return NextResponse.json(toPublicView(record));
  } catch (err) {
    const message =
      err instanceof SessionKeyPersistError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to load session key";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/auth-session-key
 * Registers an ephemeral session key after (or without) on-chain grant.
 *
 * Body (preferred):
 *   { walletAddress, sessionAddress, sessionKey, grantTxHash?, onChainGranted }
 * Aliases accepted:
 *   address → sessionAddress, privateKey → sessionKey
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const walletAddress = typeof b.walletAddress === "string" ? b.walletAddress : "";
  const sessionAddress =
    (typeof b.sessionAddress === "string" && b.sessionAddress) ||
    (typeof b.address === "string" && b.address) ||
    "";
  const sessionKey =
    (typeof b.sessionKey === "string" && b.sessionKey) ||
    (typeof b.privateKey === "string" && b.privateKey) ||
    "";
  const grantTxHash =
    typeof b.grantTxHash === "string" && b.grantTxHash.startsWith("0x")
      ? b.grantTxHash
      : null;
  const onChainGranted = Boolean(b.onChainGranted);

  const headerWallet = request.headers.get("x-wallet-address")?.trim();
  if (
    headerWallet &&
    isAddress(headerWallet) &&
    walletAddress &&
    headerWallet.toLowerCase() !== walletAddress.toLowerCase()
  ) {
    return NextResponse.json(
      { error: "x-wallet-address does not match body.walletAddress" },
      { status: 403 },
    );
  }

  if (!isAddress(walletAddress) || !isAddress(sessionAddress) || !isPrivateKey(sessionKey)) {
    return NextResponse.json(
      {
        error:
          "walletAddress, sessionAddress/address (0x+40 hex), and sessionKey/privateKey (0x+64 hex) are required",
      },
      { status: 400 },
    );
  }

  if (sessionAddress.toLowerCase() === walletAddress.toLowerCase()) {
    return NextResponse.json(
      { error: "sessionAddress must be an ephemeral key, not the owner wallet" },
      { status: 400 },
    );
  }

  try {
    const record = await putSessionKey({
      walletAddress,
      sessionAddress,
      sessionKey,
      grantTxHash,
      onChainGranted,
    });
    const backend = resolveSessionKeyBackend();
    return NextResponse.json({
      address: record.sessionAddress,
      ...toPublicView(record, backend),
    });
  } catch (err) {
    const message =
      err instanceof SessionKeyPersistError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to persist session key";
    const status = err instanceof SessionKeyPersistError ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * DELETE /api/auth-session-key
 * Clears the session-key record (Settings revoke). On-chain revoke is
 * performed client-side via setOperatorApprovalGlobal(approved: false).
 */
export async function DELETE(request: NextRequest) {
  const wallet = walletFrom(request);
  if (!wallet) {
    return NextResponse.json(
      { error: "wallet address required (x-wallet-address or ?wallet=)" },
      { status: 400 },
    );
  }

  try {
    const deleted = await deleteSessionKey(wallet);
    return NextResponse.json({
      ok: true,
      deleted,
      walletAddress: wallet.toLowerCase(),
      storeBackend: resolveSessionKeyBackend(),
    });
  } catch (err) {
    const message =
      err instanceof SessionKeyPersistError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to delete session key";
    const status = err instanceof SessionKeyPersistError ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
