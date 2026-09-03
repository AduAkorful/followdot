import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const mk = new SomniaMarkets({
  chain: somniaShannon,
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  addresses: SOMNIA_TESTNET_ADDRESSES,
});
await mk.loadMarkets();
const markets = await mk.client.listPastBinaryMarkets({ limit: 5 });
console.log(JSON.stringify(markets.map(m => ({
  id: m.marketId.slice(0, 12),
  question: m.question.slice(0, 40),
  status: m.winningOutcome !== null ? "RESOLVED" : m.voided ? "VOIDED" : "OPEN",
  expiry: new Date(Number(m.expiry) * 1000).toISOString(),
  winningOutcome: m.winningOutcome,
})), null, 2));
