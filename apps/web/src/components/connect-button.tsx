'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useAccount, useSwitchChain } from 'wagmi';
import { somniaChain } from '@/config/somnia';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ChevronDown, LogOut, Copy, Check, Wallet, AlertTriangle, RefreshCw } from 'lucide-react';
import { useState } from 'react';

export function ConnectButton() {
  const { login, logout, authenticated } = usePrivy();
  const { isConnected, address, chain } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [copied, setCopied] = useState(false);

  const shortenAddress = (addr: string) =>
    `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  const copyAddress = () => {
    if (address) {
      navigator.clipboard
        .writeText(address)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch((err) => {
          console.error('Failed to copy address:', err);
        });
    }
  };

  const isWrongNetwork = isConnected && chain?.id !== somniaChain.id;

  if (!authenticated && !isConnected && !address) {
    return (
      <Button
        onClick={login}
        className="bg-[var(--accent)] hover:bg-[#00e676] text-black font-semibold transition-all shadow-[0_0_15px_rgba(0,255,136,0.2)] cursor-pointer"
      >
        <Wallet className="mr-2 h-4 w-4" />
        Connect Wallet
      </Button>
    );
  }

  if (isWrongNetwork) {
    return (
      <Button
        onClick={() => switchChain({ chainId: somniaChain.id })}
        disabled={isSwitching}
        className="bg-amber-500 hover:bg-amber-600 text-black font-semibold transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)] animate-pulse cursor-pointer"
      >
        {isSwitching ? (
          <>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Switching…
          </>
        ) : (
          <>
            <AlertTriangle className="mr-2 h-4 w-4" />
            Switch to Somnia Testnet
          </>
        )}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 border border-white/10 bg-white/5 hover:bg-white/10 rounded-full px-3 py-1.5 cursor-pointer text-sm font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <Avatar className="h-6 w-6">
          <AvatarFallback className="bg-[var(--accent)] text-black text-[10px] font-bold">
            {address ? address.slice(2, 4).toUpperCase() : '0X'}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-mono">{address ? shortenAddress(address) : 'Connected'}</span>
        <ChevronDown className="h-3 w-3 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="flex flex-col space-y-1">
              <span className="text-xs text-muted-foreground">Connected Wallet</span>
              <span className="text-sm font-mono font-medium">{address ? shortenAddress(address) : ''}</span>
              <span className="text-[10px] text-[var(--accent)] font-medium">Somnia Testnet (50312)</span>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={copyAddress} className="cursor-pointer">
          {copied ? <Check className="mr-2 h-4 w-4 text-[var(--accent)]" /> : <Copy className="mr-2 h-4 w-4" />}
          {copied ? 'Copied!' : 'Copy address'}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => logout()}
          className="text-destructive cursor-pointer"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
