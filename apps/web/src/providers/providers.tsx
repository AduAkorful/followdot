'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider, createConfig } from '@privy-io/wagmi';
import { http } from 'wagmi';
import { somniaChain } from '@/config/somnia';
import { ReactNode, useState } from 'react';

function requirePublicEnv(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is not configured`);
  return value;
}

const privyAppId = requirePublicEnv(process.env.NEXT_PUBLIC_PRIVY_APP_ID, 'NEXT_PUBLIC_PRIVY_APP_ID');
const rpcUrl = requirePublicEnv(process.env.NEXT_PUBLIC_RPC_URL, 'NEXT_PUBLIC_RPC_URL');

const wagmiConfig = createConfig({
  chains: [somniaChain],
  transports: {
    [somniaChain.id]: http(rpcUrl),
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
