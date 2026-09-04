import { fetchWhaleLeaderboard } from "./src/lib/whales";
import { fetchRecentFills } from "./src/lib/dreamdex";
import { createDreamDexSDK, getSomniaMarketsClient } from "@followdot/sdk-helpers";

createDreamDexSDK({
  restUrl: "https://dev.smk.somnia.host/v1/graphql",
  wsUrl: "wss://api.infra.testnet.somnia.network/ws",
});

console.log("=== checking fills ===");
const fills = await fetchRecentFills(100);
console.log("fills:", fills.length);
const bot = fills.filter(f => f.taker?.toLowerCase() === "0x74b4134c8d527a8d8ae8cb9503ab2043bcfc0ffd" || f.maker?.toLowerCase() === "0x74b4134c8d527a8d8ae8cb9503ab2043bcfc0ffd");
console.log("bot fills:", bot.length);

console.log("\n=== checking resolved markets ===");
const sdk = getSomniaMarketsClient();
const resolved = await sdk.listPastBinaryMarkets({ limit: 5 });
console.log("resolved:", resolved.filter(m => m.winningOutcome !== null).length, "of", resolved.length);
resolved.slice(0, 2).forEach(m => console.log(" -", m.marketId, m.question.slice(0, 30), m.winningOutcome));

console.log("\n=== leaderboard (top 5) ===");
const lb = await fetchWhaleLeaderboard(5);
console.log("entries:", lb.length);
lb.slice(0, 3).forEach(w => console.log(" -", w.address.slice(0, 10), "score:", w.score.toFixed(3), "markets:", w.totalMarkets));
