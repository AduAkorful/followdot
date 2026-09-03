import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, encodeFunctionData } from "viem";

const PK = "0x7ca5d2f4cb7131e066e052d2e3ecaadd261bb52b89bf45b69aaa84c1a175a75d" as `0x${string}`;
const USDC = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E" as const;
const AMOUNT = 100n * 10n ** 6n;

const account = privateKeyToAccount(PK);
console.log("Wallet:", account.address);

const publicClient = createPublicClient({
  chain: somniaShannon,
  transport: http("https://api.infra.testnet.somnia.network"),
});

const balBefore = (await publicClient.readContract({
  address: USDC,
  abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
  functionName: "balanceOf",
  args: [account.address],
})) as bigint;
console.log("USDC bal before:", balBefore.toString());

const mk = new SomniaMarkets({
  chain: somniaShannon,
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
  privateKey: PK,
});
await mk.loadMarkets();
const trader = mk.createTrader({ privateKey: PK });

// Try direct mint with the standard selector 0x40c10f19
const mintData = encodeFunctionData({
  abi: [{
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  }],
  functionName: "mint",
  args: [account.address, AMOUNT],
});

try {
  const hash = await trader.writeContract({
    address: USDC,
    abi: [{
      type: "function",
      name: "mint",
      stateMutability: "nonpayable",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [],
    }],
    functionName: "mint",
    args: [account.address, AMOUNT],
    gas: 200_000n,
  });
  console.log("TX:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Status:", receipt.status);
  const balAfter = (await publicClient.readContract({
    address: USDC,
    abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  console.log("USDC bal after:", balAfter.toString());
} catch (e: any) {
  console.log("MINT_ERR:", e.shortMessage ?? e.message);
}
