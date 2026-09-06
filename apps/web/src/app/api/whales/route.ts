import { NextResponse } from "next/server";
import { getCachedWhaleLeaderboard } from "@/lib/whales";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Server-side leaderboard. Running this in the browser hangs because it
 * pages hundreds of past markets and then fans out per-trader fill + RPC
 * balance reads under a single React Query load state.
 *
 * Responses are served from an in-process stale-while-revalidate cache so
 * home dashboard TTFB stays low after the first warm.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = Number(searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 20;

  try {
    const t0 = Date.now();
    const { whales, count, generatedAt, cache } = await getCachedWhaleLeaderboard(
      limit,
      request.signal,
    );
    const ms = Date.now() - t0;
    console.info(`[api/whales] limit=${limit} cache=${cache} count=${count} ${ms}ms`);
    return NextResponse.json(
      { whales, count, generatedAt },
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
    console.error("[api/whales]", message);
    return NextResponse.json({ error: message, whales: [] }, { status: 502 });
  }
}
