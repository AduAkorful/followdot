import { NextResponse } from "next/server";
import { fetchWhaleProfileCore } from "@/lib/whale-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Critical-path whale profile (score, marketPnL, fills, openPositions).
 * Edge/calibration live under /analytics so KPIs are not blocked by 2×N RPCs.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ address: string }> },
) {
  const { address } = await context.params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  try {
    const profile = await fetchWhaleProfileCore(address);
    return NextResponse.json(
      { profile, generatedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api/whales/${address}]`, message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
