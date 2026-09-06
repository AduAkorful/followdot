'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useAccount, useDisconnect, useSwitchChain } from 'wagmi';
import { somniaChain } from '@/config/somnia';
import { useWalletSession } from '@/hooks/use-wallet-session';
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
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type ConnectButtonProps = {
  /** Sidebar footer needs full-width control + menu that opens upward above z-100. */
  placement?: 'topbar' | 'sidebar';
};

export function ConnectButton({ placement = 'topbar' }: ConnectButtonProps) {
  const { login, logout, authenticated, ready } = usePrivy();
  const { isConnected, address: wagmiAddress } = useAccount();
  const { hasWalletSession, address, isWrongNetwork } = useWalletSession();
  const { disconnectAsync } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [copied, setCopied] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const hadLiveWallet = useRef(false);
  const isSidebar = placement === 'sidebar';

  useEffect(() => {
    if (isConnected && wagmiAddress) {
      hadLiveWallet.current = true;
    }
  }, [isConnected, wagmiAddress]);

  // If wagmi drops after a live session, clear the leftover Privy session too.
  useEffect(() => {
    if (!ready || isDisconnecting) return;
    if (hadLiveWallet.current && authenticated && !isConnected) {
      hadLiveWallet.current = false;
      void logout();
    }
  }, [ready, authenticated, isConnected, isDisconnecting, logout]);

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

  const handleDisconnect = async () => {
    if (isDisconnecting) return;
    setIsDisconnecting(true);
    try {
      // Privy session and wagmi connector are independent; clear both or the
      // button stays in the "connected" branch via isConnected/address.
      await Promise.allSettled([
        logout(),
        isConnected ? disconnectAsync() : Promise.resolve(),
      ]);
    } catch (err) {
      console.error('Failed to disconnect wallet:', err);
    } finally {
      hadLiveWallet.current = false;
      setIsDisconnecting(false);
    }
  };

  if (!hasWalletSession || !address) {
    if (isSidebar) {
      return (
        <button type="button" onClick={login} className="connect-wallet-btn cursor-pointer">
          <Wallet className="h-4 w-4" />
          Connect Wallet
        </button>
      );
    }
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
        className={cn(
          'bg-amber-500 hover:bg-amber-600 text-black font-semibold transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)] animate-pulse cursor-pointer',
          isSidebar && 'w-full',
        )}
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
      <DropdownMenuTrigger
        className={cn(
          'flex items-center gap-2 border border-white/10 bg-white/5 hover:bg-white/10 cursor-pointer text-sm font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring',
          isSidebar
            ? 'w-full justify-between rounded-[var(--radius-md)] px-3 py-2.5 border-[var(--border-accent)] bg-transparent hover:bg-[var(--accent-dim)]'
            : 'rounded-full px-3 py-1.5',
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Avatar className="h-6 w-6 shrink-0">
            <AvatarFallback className="bg-[var(--accent)] text-black text-[10px] font-bold">
              {address.slice(2, 4).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-mono truncate">{shortenAddress(address)}</span>
        </span>
        <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={isSidebar ? 'start' : 'end'}
        side={isSidebar ? 'top' : 'bottom'}
        sideOffset={8}
        className="w-56 p-1.5"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-2 text-[var(--text-primary)]">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Connected
              </span>
              <span className="text-sm font-mono font-medium text-[var(--text-primary)]">
                {shortenAddress(address)}
              </span>
              <span className="text-[11px] font-medium text-[var(--accent)]">
                Somnia Testnet (50312)
              </span>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="bg-[var(--border)]" />
        <DropdownMenuItem
          onClick={copyAddress}
          className="cursor-pointer rounded-md px-2 py-2 text-[var(--text-primary)] focus:bg-[var(--bg-card-hover)]"
        >
          {copied ? (
            <Check className="mr-2 h-4 w-4 text-[var(--accent)]" />
          ) : (
            <Copy className="mr-2 h-4 w-4 text-[var(--text-secondary)]" />
          )}
          {copied ? 'Copied!' : 'Copy address'}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void handleDisconnect();
          }}
          disabled={isDisconnecting}
          className="cursor-pointer rounded-md px-2 py-2 text-destructive focus:bg-destructive/10"
        >
          <LogOut className="mr-2 h-4 w-4" />
          {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
