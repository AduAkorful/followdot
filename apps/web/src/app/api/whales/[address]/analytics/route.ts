import { NextResponse } from "next/server";
import { fetchWhaleProfileAnalytics } from "@/lib/whale-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lazy F7/F8 analytics for a whale — keep off the KPI critical path. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ address: string }> },
) {
  const { address } = await context.params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  try {
    const analytics = await fetchWhaleProfileAnalytics(address);
    return NextResponse.json(
      { analytics, generatedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "s-maxage=60, stale-while-revalidate=120",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api/whales/${address}/analytics]`, message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
