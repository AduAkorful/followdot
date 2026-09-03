import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const mk = new SomniaMarkets({
  chain: somniaShannon,
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
});
await mk.loadMarkets();
console.log("top-level:", Object.getOwnPropertyNames(Object.getPrototypeOf(mk)).filter(k=>k!='constructor'));
console.log("client keys:", Object.keys(mk.client).slice(0,30));
