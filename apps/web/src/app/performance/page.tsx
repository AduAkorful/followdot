'use client';

import { useMemo, useState } from 'react';
import { ManagePositionModal } from '@/components/manage-position-modal';
import { Pagination } from '@/components/pagination';
import { ConnectButton } from '@/components/connect-button';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { useWalletPortfolio } from '@/hooks/use-portfolio';
import { Loader2, AlertCircle } from 'lucide-react';
import Link from 'next/link';

interface PositionItem {
  marketId: string;
  title: string;
  whaleAddress: string | null;
  outcome: string;
  stake: number;
  currentValue: number;
  pnl: number;
  timestamp: string;
  status: 'OPEN' | 'SETTLED';
}

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function PerformancePage() {
  const { hasWalletSession, address } = useWalletSession();
  const {
    data: portfolio,
    isLoading,
    isError,
    error,
    isFetching,
  } = useWalletPortfolio();
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const [selectedPosition, setSelectedPosition] = useState<PositionItem | null>(null);
  const [manageModalOpen, setManageModalOpen] = useState(false);

  const activePositions: PositionItem[] = useMemo(() => {
    if (!portfolio?.positions?.length) return [];
    return portfolio.positions.flatMap((position) => {
      const decimals = position.market.quoteDecimals;
      if (!Number.isInteger(decimals) || decimals < 0) return [];
      const yesHeld = position.balanceYes > 0n;
      const noHeld = position.balanceNo > 0n;
      if (yesHeld === noHeld) return [];
      const scale = 10 ** decimals;
      return [{
        marketId: position.market.id,
        title: position.market.question
          || (position.market.asset && position.market.interval
            ? `${position.market.asset} ${position.market.interval}`
            : shorten(position.market.marketAddress || position.market.id)),
        whaleAddress: null,
        outcome: yesHeld ? 'YES' : 'NO',
        stake: Number(position.costBasis) / scale,
        currentValue: Number(position.markValue) / scale,
        pnl: Number(position.unrealizedPnl) / scale,
        timestamp: position.market.expiry ?? '',
        status: 'OPEN' as const,
      }];
    });
  }, [portfolio]);

  const fillCount = portfolio?.fills?.length ?? 0;
  const hasAnyActivity = activePositions.length > 0 || fillCount > 0;
  const totalUnrealized = activePositions.reduce((sum, p) => sum + p.pnl, 0);

  const totalEntries = activePositions.length;
  const paginatedPositions = activePositions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handleManagePosition = (pos: PositionItem) => {
    setSelectedPosition(pos);
    setManageModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h2 className="page-title">My Performance</h2>
        <p className="page-subtitle">
          Track your wallet portfolio, fills, and open positions on DreamDEX event markets.
        </p>
      </div>

      {!hasWalletSession ? (
        <div className="card animate-in delay-1 text-center py-12">
          <p className="text-[var(--text-secondary)] mb-4">
            Connect your wallet to load live performance from your portfolio and fills.
          </p>
          <ConnectButton />
        </div>
      ) : isLoading ? (
        <div className="card animate-in delay-1 flex items-center justify-center py-16 text-[var(--text-muted)]">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Loading wallet portfolio…
        </div>
      ) : isError ? (
        <div className="card animate-in delay-1 flex items-center justify-center py-12 text-[var(--red)]">
          <AlertCircle className="w-5 h-5 mr-2" />
          {error?.message ?? 'Unable to load portfolio'}
        </div>
      ) : (
        <>
          <div className="stats-row animate-in delay-1">
            <div className="stat-card">
              <div className="stat-label">Open Unrealized PnL</div>
              <div className="stat-row">
                <div className={`stat-value ${
                  !hasAnyActivity
                    ? 'text-[var(--text-secondary)]'
                    : totalUnrealized >= 0
                      ? 'text-[var(--green)]'
                      : 'text-[var(--red)]'
                }`}>
                  {!hasAnyActivity
                    ? '—'
                    : `${totalUnrealized >= 0 ? '+' : ''}$${totalUnrealized.toFixed(2)}`}
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-2">
                {hasAnyActivity
                  ? 'From live open positions'
                  : 'No copied trades yet'}
              </p>
            </div>

            <div className="stat-card">
              <div className="stat-label">Indexed Fills</div>
              <div className="stat-row">
                <div className={`stat-value ${fillCount === 0 ? 'text-[var(--text-secondary)]' : ''}`}>
                  {fillCount === 0 ? '—' : fillCount}
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-2">
                {fillCount === 0 ? 'No fills indexed for this wallet' : 'Binary fills from the indexer'}
              </p>
            </div>

            <div className="stat-card">
              <div className="stat-label">Open Positions</div>
              <div className="stat-row">
                <div className={`stat-value ${activePositions.length === 0 ? 'text-[var(--text-secondary)]' : ''}`}>
                  {activePositions.length === 0 ? '—' : activePositions.length}
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-2">
                {isFetching ? 'Refreshing…' : 'From live wallet portfolio query'}
              </p>
            </div>

            <div className="stat-card">
              <div className="stat-label">Whales Monitored</div>
              <div className="stat-row">
                <div className="stat-value text-[var(--text-secondary)]">—</div>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-2">No follow rules loaded</p>
            </div>
          </div>

          <div className="card animate-in delay-2">
            <div className="card-header flex flex-row items-center justify-between">
              <div>
                <h3 className="card-title">Portfolio Growth</h3>
                <p className="card-desc">Cumulative PnL across settled fills (when available)</p>
              </div>
              <span className="badge badge-outline">
                {hasAnyActivity ? `${fillCount} fills` : 'No data'}
              </span>
            </div>
            <div className="card-body mt-2 text-center py-10 text-[var(--text-muted)] text-sm">
              {hasAnyActivity
                ? 'Equity curve for copy-attributed fills is not wired yet — open positions and fills below are live.'
                : 'No copied trades yet. Equity curve appears after live fills are available for this wallet.'}
            </div>
          </div>
        </>
      )}

      {/* Trade / Position History Table */}
      <div className="card animate-in delay-3">
        <div className="card-header">
          <h3 className="card-title">Open Positions</h3>
          <p className="card-desc">Live outcome-token holdings from getOpenPositionsWithPnL</p>
        </div>
        <div className="card-body p-0 mt-4 overflow-x-auto">
          {!hasWalletSession ? (
            <div className="text-center py-16">
              <p className="text-[var(--text-secondary)] mb-4">
                Connect your Web3 wallet to view your portfolio and performance analytics.
              </p>
              <ConnectButton />
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Querying wallet portfolio…
            </div>
          ) : isError ? (
            <div className="flex items-center justify-center py-12 text-[var(--red)]">
              <AlertCircle className="w-5 h-5 mr-2" />
              {error?.message}
            </div>
          ) : activePositions.length === 0 ? (
            <div className="text-center py-16 text-[var(--text-muted)]">
              No copied trades yet for connected wallet{' '}
              <code className="font-mono text-[var(--accent)]">
                {address?.slice(0, 6)}…{address?.slice(-4)}
              </code>
              {fillCount > 0
                ? ` (${fillCount} historical fills indexed; no open positions).`
                : '.'}{' '}
              Visit the{' '}
              <Link href="/" className="text-[var(--accent)] underline hover:opacity-80">
                Leaderboard
              </Link>{' '}
              to place your first copy trade.
            </div>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Whale</th>
                    <th>Outcome</th>
                    <th className="right">Stake</th>
                    <th className="right">Current Value</th>
                    <th className="right">PnL</th>
                    <th className="right">Status</th>
                    <th className="right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPositions.map((pos) => {
                    const isPositive = pos.pnl >= 0;
                    return (
                      <tr key={pos.marketId}>
                        <td className="font-medium">{pos.title}</td>
                        <td className="mono text-xs text-[var(--text-secondary)]">
                          {pos.whaleAddress ? (
                            <Link href={`/whale/${pos.whaleAddress}`} className="hover:underline">
                              {shorten(pos.whaleAddress)}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <span className="badge badge-accent">{pos.outcome}</span>
                        </td>
                        <td className="right mono">${pos.stake.toFixed(2)}</td>
                        <td className="right mono">${pos.currentValue.toFixed(2)}</td>
                        <td className={`right mono font-semibold ${isPositive ? 'green' : 'red'}`}>
                          {isPositive ? '+' : ''}${pos.pnl.toFixed(2)}
                        </td>
                        <td className="right">
                          <span className="badge badge-outline">{pos.status}</span>
                        </td>
                        <td className="right">
                          <button
                            onClick={() => handleManagePosition(pos)}
                            className="btn btn-ghost btn-sm text-[var(--accent)]"
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <Pagination
                currentPage={currentPage}
                totalItems={totalEntries}
                pageSize={pageSize}
                onPageChange={(p) => setCurrentPage(p)}
              />
            </>
          )}
        </div>
      </div>

      <ManagePositionModal
        open={manageModalOpen}
        onOpenChange={setManageModalOpen}
        position={selectedPosition}
        onClosePosition={async () => {
          // Close path not wired to a live sell API yet.
        }}
      />
    </div>
  );
}
