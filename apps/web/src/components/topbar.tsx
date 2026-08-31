'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { somniaChain } from '@/config/somnia';
import { Search } from 'lucide-react';
import { ConnectButton } from './connect-button';

export function Topbar() {
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();
  const { isConnected, chain } = useAccount();

  const isWrongNetwork = isConnected && chain?.id !== somniaChain.id;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (query) {
      if (query.startsWith('0x') && query.length === 42) {
        router.push(`/whale/${query}`);
      } else {
        router.push(`/?search=${encodeURIComponent(query)}`);
      }
    }
  };

  return (
    <div className="topbar-shell">
      <form onSubmit={handleSearch} className="search-box">
        <Search />
        <input
          type="text"
          placeholder="Search wallets (0x...)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <span className="shortcut">⌘K</span>
      </form>

      <div className="topbar-right">
        {isWrongNetwork ? (
          <span className="badge badge-outline border-amber-500/50 bg-amber-500/10 text-amber-400 flex items-center gap-1.5 px-3 py-1 text-xs">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
            Wrong Network
          </span>
        ) : (
          <span className="badge badge-outline flex items-center gap-1.5 px-3 py-1 text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Somnia Testnet
          </span>
        )}
        <ConnectButton />
      </div>
    </div>
  );
}
