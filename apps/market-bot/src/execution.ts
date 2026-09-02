import type { FillRow, SomniaMarkets } from "@somnia-chain/markets-sdk";
import { sleep } from "./util.js";

export interface IndexedExecution {
  txHash: string;
  fill: FillRow;
}

export async function waitForIndexedFill(
  sdk: SomniaMarkets,
  account: string,
  pool: string,
  txHash: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<IndexedExecution> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fills = await sdk.client.getUserFills(account, { pool, limit: 100 });
    const fill = fills.find((row) => row.txHash.toLowerCase() === txHash.toLowerCase());
    if (fill) return { txHash, fill };
    await sleep(pollIntervalMs);
  }
  throw new Error(`Transaction ${txHash} confirmed but its fill is not indexed yet`);
}
