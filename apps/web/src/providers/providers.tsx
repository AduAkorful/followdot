'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider, createConfig } from '@privy-io/wagmi';
import { http, fallback } from 'wagmi';
import { somniaChain } from '@/config/somnia';
import { ReactNode, useState } from 'react';

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || 'cmthpl5os01710cl7qi2x0s3u';

const wagmiConfig = createConfig({
  chains: [somniaChain],
  transports: {
    [somniaChain.id]: fallback([
      http(),
      http(somniaChain.rpcUrls.default.http[0]),
    ]),
  },
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#10b981',
          showWalletLoginFirst: true,
        },
        loginMethods: ['wallet', 'email', 'google', 'twitter'],
        defaultChain: somniaChain,
        supportedChains: [somniaChain],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

export default Providers;
