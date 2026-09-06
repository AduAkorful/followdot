import { NextRequest, NextResponse } from "next/server";
import {
  defaultFollowRule,
  deleteFollowRule,
  FollowRulesPersistError,
  followRulesPersistenceMeta,
  isAddress,
  listFollowRules,
  resolveFollowRulesBackend,
  toPublicRule,
  upsertFollowRule,
} from "@/lib/follow-rules-store";
import type { AutoCopyRule } from "@/components/edit-rule-modal";

export const dynamic = "force-dynamic";

function walletFrom(request: NextRequest, bodyWallet?: string): string | null {
  const header = request.headers.get("x-wallet-address")?.trim();
  const query = request.nextUrl.searchParams.get("wallet")?.trim();
  const candidate = header || bodyWallet || query || "";
  return isAddress(candidate) ? candidate : null;
}

/**
 * GET /api/follow-rules?wallet=0x…
 * Lists persisted Auto-Follow rules for the follower wallet.
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
    const rules = await listFollowRules(wallet);
    const backend = resolveFollowRulesBackend();
    return NextResponse.json({
      walletAddress: wallet.toLowerCase(),
      rules: rules.map(toPublicRule),
      ...followRulesPersistenceMeta(backend),
    });
  } catch (err) {
    const message =
      err instanceof FollowRulesPersistError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to load follow rules";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/follow-rules
 * Upserts one rule. Body: { walletAddress, rule } — omit rule fields to use defaults
 * when creating (pass { whaleAddress } only).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const walletAddress =
    typeof b.walletAddress === "string" ? b.walletAddress : walletFrom(request) ?? "";
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

  if (!isAddress(walletAddress)) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }

  const ruleBody = (b.rule && typeof b.rule === "object" ? b.rule : b) as Partial<AutoCopyRule> & {
    whaleAddress?: string;
  };
  const whaleAddress =
    typeof ruleBody.whaleAddress === "string"
      ? ruleBody.whaleAddress
      : typeof b.whaleAddress === "string"
        ? b.whaleAddress
        : "";

  if (!isAddress(whaleAddress)) {
    return NextResponse.json({ error: "rule.whaleAddress required" }, { status: 400 });
  }

  try {
    const base = defaultFollowRule(whaleAddress);
    const saved = await upsertFollowRule(walletAddress, {
      ...base,
      ...ruleBody,
      whaleAddress,
    });
    const backend = resolveFollowRulesBackend();
    return NextResponse.json({
      ok: true,
      walletAddress: walletAddress.toLowerCase(),
      rule: toPublicRule(saved),
      ...followRulesPersistenceMeta(backend),
    });
  } catch (err) {
    const message =
      err instanceof FollowRulesPersistError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to persist follow rule";
    const status = err instanceof FollowRulesPersistError ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * DELETE /api/follow-rules?wallet=0x…&whale=0x…
 * Removes one whale rule for the follower.
 */
export async function DELETE(request: NextRequest) {
  const wallet = walletFrom(request);
  const whale =
    request.nextUrl.searchParams.get("whale")?.trim() ||
    request.headers.get("x-whale-address")?.trim() ||
    "";

  if (!wallet) {
    return NextResponse.json(
      { error: "wallet address required (x-wallet-address or ?wallet=)" },
      { status: 400 },
    );
  }
  if (!isAddress(whale)) {
    return NextResponse.json({ error: "whale address required (?whale=)" }, { status: 400 });
  }

  try {
    const deleted = await deleteFollowRule(wallet, whale);
    return NextResponse.json({
      ok: true,
      deleted,
      walletAddress: wallet.toLowerCase(),
      whaleAddress: whale.toLowerCase(),
      storeBackend: resolveFollowRulesBackend(),
    });
  } catch (err) {
    const message =
      err instanceof FollowRulesPersistError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to delete follow rule";
    const status = err instanceof FollowRulesPersistError ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
