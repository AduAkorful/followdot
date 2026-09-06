import { NextResponse } from "next/server";
import { getCachedWhaleProfileCore } from "@/lib/whale-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Critical-path whale profile (score, marketPnL, fills, openPositions).
 * Edge/calibration live under /analytics so KPIs are not blocked by 2×N RPCs.
 * Served from in-process SWR cache after the first warm.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ address: string }> },
) {
  const { address } = await context.params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  try {
    const t0 = Date.now();
    const { cache, ...profile } = await getCachedWhaleProfileCore(
      address,
      request.signal,
    );
    const ms = Date.now() - t0;
    console.info(`[api/whales/${address}] cache=${cache} ${ms}ms`);
    return NextResponse.json(
      { profile, generatedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "s-maxage=30, stale-while-revalidate=120",
          "X-Followdot-Cache": cache,
          "X-Followdot-Elapsed-Ms": String(ms),
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api/whales/${address}]`, message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
