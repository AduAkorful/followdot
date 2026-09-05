import type { FillRow, SomniaMarkets } from "@somnia-chain/markets-sdk";
import { sleep } from "./util.js";

export interface IndexedExecution {
  txHash: string;
  fill: FillRow;
}

export async function waitForIndexedFill(
  _sdk: SomniaMarkets,
  account: string,
  pool: string,
  txHash: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<IndexedExecution> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Direct GraphQL — bypass SDK's slow `takerOrder.owner` join.
    const q = `
      query WaitForFill($acct: String!, $pool: String!) {
        Fill(
          where: {
            pool: { _eq: $pool },
            _or: [{ maker: { _eq: $acct } }, { taker: { _eq: $acct } }]
          },
          limit: 50, order_by: [{ timestamp: desc }]
        ) {
          id txHash market { id } pool maker taker makerSide takerSide
          fillPrice quantity quoteQuantity timestamp
        }
      }
    `;
    const r = await fetch("https://dev.smk.somnia.host/v1/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q, variables: { acct: account.toLowerCase(), pool: pool.toLowerCase() } }),
    });
    if (r.ok) {
      const d = (await r.json()) as { data?: { Fill?: Array<{ txHash?: string } & Record<string, unknown>> } };
      const fills = d.data?.Fill ?? [];
      const fill = fills.find((row) => (row.txHash ?? "").toLowerCase() === txHash.toLowerCase());
      if (fill) return { txHash, fill: fill as unknown as IndexedExecution["fill"] };
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`Transaction ${txHash} confirmed but its fill is not indexed yet`);
}
