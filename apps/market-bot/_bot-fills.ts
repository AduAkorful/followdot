import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { registerIndexerSignal } from "@somnia-chain/markets-sdk/dist/indexerRead";

async function main() {
  const abortCtrl = new AbortController();
  const to = setTimeout(() => abortCtrl.abort(), 20_000);

  const mk = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });
  registerIndexerSignal("https://dev.smk.somnia.host/v1/graphql", abortCtrl.signal);
  await mk.loadMarkets();

  const BOT = "0x74B4134C8d527a8D8AE8cb9503ab2043bCfC0ffd";
  const fills = await mk.client.getUserFills(BOT, { limit: 200, offset: 0 });
  clearTimeout(to);
  console.log("Fills count:", fills.length);
  for (const f of fills) {
    console.log(`  market=${f.market} side=${f.takerSide} price=${f.price} qty=${f.quantity}`);
  }
}
main().catch((e) => console.log("ERR:", e.name === "AbortError" ? "TIMEOUT" : e.message));
