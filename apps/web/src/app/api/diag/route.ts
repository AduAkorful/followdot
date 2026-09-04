import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const rest = process.env.NEXT_PUBLIC_DREAMDEX_REST ?? "(unset)";
  const ws = process.env.NEXT_PUBLIC_DREAMDEX_WS ?? "(unset)";
  const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "(unset)";

  let probe: { ok: boolean; status: number; body: string } = { ok: false, status: 0, body: "" };
  if (rest && rest !== "(unset)") {
    try {
      const res = await fetch(rest, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "{ Market(limit: 1) { id } }" }),
      });
      probe = {
        ok: res.ok,
        status: res.status,
        body: (await res.text()).slice(0, 200),
      };
    } catch (err) {
      probe = { ok: false, status: 0, body: `fetch error: ${(err as Error).message}` };
    }
  }

  return NextResponse.json({
    rest,
    ws,
    rpc,
    indexerProbe: probe,
    now: new Date().toISOString(),
  });
}
