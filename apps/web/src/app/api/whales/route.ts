import { NextResponse } from "next/server";
import { fetchWhaleLeaderboard } from "@/lib/whales";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Server-side leaderboard. Running this in the browser hangs because it
 * pages hundreds of past markets and then fans out per-trader fill + RPC
 * balance reads under a single React Query load state.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = Number(searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 20;

  try {
    const whales = await fetchWhaleLeaderboard(limit);
    return NextResponse.json(
      { whales, count: whales.length, generatedAt: new Date().toISOString() },
      {
        headers: {
          // Short cache so Vercel edge can absorb refresh storms.
          "Cache-Control": "s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/whales]", message);
    return NextResponse.json({ error: message, whales: [] }, { status: 502 });
  }
}
