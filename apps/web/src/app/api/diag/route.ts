import { NextResponse } from "next/server";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

export const dynamic = "force-dynamic";

async function timed<T>(label: string, p: Promise<T>, ms = 15_000): Promise<{ label: string; ok: boolean; ms: number; error?: string; count?: number }> {
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    const result = await Promise.race([p, timeout]);
    clearTimeout(timer!);
    const count = Array.isArray(result) ? result.length : undefined;
    return { label, ok: true, ms: Date.now() - start, count };
  } catch (err) {
    clearTimeout(timer!);
    return { label, ok: false, ms: Date.now() - start, error: (err as Error).message };
  }
}

export async function GET() {
  const rest = process.env.NEXT_PUBLIC_DREAMDEX_REST ?? "(unset)";
  const ws = process.env.NEXT_PUBLIC_DREAMDEX_WS ?? "(unset)";
  const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "(unset)";

  const sdk = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: rest,
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });

  const probes: Array<{ label: string; ok: boolean; ms: number; error?: string; count?: number }> = [];

  // Stage 1 — loadMarkets (loads operators / venues)
  probes.push(await timed("loadMarkets", sdk.loadMarkets()));

  // Stage 2 — listPastBinaryMarkets page 1
  const past = await timed("listPastBinaryMarkets(page1)", sdk.client.listPastBinaryMarkets({ limit: 50, offset: 0 }));
  probes.push(past);

  // Stage 3 — listLiveBinaryMarkets (small)
  probes.push(await timed("listLiveBinaryMarkets", sdk.client.listLiveBinaryMarkets({ limit: 10 })));

  // Stage 4 — getFills (most recent 50 on first live market)
  if (past.ok && Array.isArray(past.count) && (past as { result?: unknown[] }).result) {
    const m = await sdk.client.getBinaryMarket("0x0000000000000000000000000000000000000000000000000000000000000073");
    if (m?.poolAddress) {
      probes.push(await timed("getFills(pool, 50)", sdk.client.getFills(m.poolAddress, { limit: 50, offset: 0 })));
    }
  }

  // Stage 5 — getUserFills (the suspected hang)
  probes.push(await timed("getUserFills(known-trader, 50)", sdk.client.getUserFills("0x74B4134C8d527a8D8AE8cb9503ab2043bCfC0ffd", { limit: 50, offset: 0 })));

  return NextResponse.json({
    rest,
    ws,
    rpc,
    probes,
    now: new Date().toISOString(),
  });
}

