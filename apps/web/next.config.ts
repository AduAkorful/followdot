import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Monorepo: locate the workspace's `next` package from the repo root so
  // Turbopack can resolve it from the web app's source tree.
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Content-Security-Policy",
            // Browser fetches go to the Hasura indexer + Somnia RPC + Privy/WalletConnect.
            // Keep this in sync with NEXT_PUBLIC_DREAMDEX_REST / RPC / Privy hosts.
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://privy.io https://auth.privy.io",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://dev.smk.somnia.host https://dream-rpc.somnia.network https://auth.privy.io https://privy.io https://api.dreamdex.io wss://api.infra.testnet.somnia.network https://explorer-api.walletconnect.com wss://relay.walletconnect.com wss://relay.walletconnect.org",
              "frame-src 'self' https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
