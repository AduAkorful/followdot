import { NextRequest, NextResponse } from "next/server";
import {
  deleteSessionKey,
  getSessionKey,
  isAddress,
  isPrivateKey,
  putSessionKey,
  toPublicView,
} from "@/lib/session-key-store";

export const dynamic = "force-dynamic";

function walletFrom(request: NextRequest, bodyWallet?: string): string | null {
  const header = request.headers.get("x-wallet-address")?.trim();
  const query = request.nextUrl.searchParams.get("wallet")?.trim();
  const candidate = header || bodyWallet || query || "";
  return isAddress(candidate) ? candidate : null;
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

  const record = await getSessionKey(wallet);
  if (!record) {
    return NextResponse.json({
      active: false,
      walletAddress: wallet.toLowerCase(),
      sessionAddress: null,
      grantTxHash: null,
      onChainGranted: false,
      workerNote:
        "No session key registered locally. Authorize to generate an ephemeral key and grant OperatorPermissionsRegistry place/cancel selectors.",
    });
  }

  return NextResponse.json(toPublicView(record));
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
    return NextResponse.json({
      address: record.sessionAddress,
      ...toPublicView(record),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to persist session key" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/auth-session-key
 * Clears the local session-key record (Settings revoke). On-chain revoke is
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

  const deleted = await deleteSessionKey(wallet);
  return NextResponse.json({
    ok: true,
    deleted,
    walletAddress: wallet.toLowerCase(),
  });
}
