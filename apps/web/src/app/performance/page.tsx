'use client';

import { useCallback, useMemo, useState } from 'react';
import { ManagePositionModal } from '@/components/manage-position-modal';
import { Pagination } from '@/components/pagination';
import { ConnectButton } from '@/components/connect-button';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { useWalletPortfolio } from '@/hooks/use-portfolio';
import { Loader2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import {
  formatOpenPositionMoney,
  formatSharesHuman,
  mapHonestOpenPositionMoney,
} from '@/lib/open-position-display';
import { withRebuiltCostBasis } from '@/lib/rebuild-cost-basis';
import {
  FOLLOW_RULES_QUERY_KEY,
  NO_WHALES_FOLLOWED_YET,
  countMonitoredWhales,
  fetchFollowRules,
} from '@/lib/follow-rules';
import { useClosePosition } from '@/hooks/use-close-position';
import { buildEquityCurvePoints } from '@/lib/equity-curve-data';
import { EquityCurve } from '@/components/equity-curve';
import { useQuery } from '@tanstack/react-query';

interface PositionItem {
  marketId: string;
  poolAddress: string;
  quoteDecimals: number;
  sellSide: 'SELL_YES' | 'SELL_NO';
  quantityRaw: bigint;
  title: string;
  whaleAddress: string | null;
  outcome: string;
  stake: number | null;
  shares: number;
  currentValue: number;
  pnl: number | null;
  costBasisUnknown: boolean;
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
  const closePosition = useClosePosition();

  // Same indexer path as whale profiles — real settled marketPnL only (no invented points).
  const equityQuery = useQuery({
    queryKey: ['wallet-equity', address],
    queryFn: async () => {
      if (!address) throw new Error('Wallet not connected');
      const res = await fetch(`/api/whales/${address}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Equity history failed (${res.status})`);
      }
      const json = (await res.json()) as {
        profile?: {
          marketPnL?: Array<{ marketId: string; pnl: number }>;
          fills?: Array<{ market: string; timestamp?: string }>;
        };
      };
      return json.profile ?? { marketPnL: [], fills: [] };
    },
    enabled: hasWalletSession && !!address,
    staleTime: 60_000,
    retry: 1,
  });

  const equityDataPoints = useMemo(
    () =>
      buildEquityCurvePoints(
        equityQuery.data?.marketPnL ?? [],
        equityQuery.data?.fills ?? [],
      ),
    [equityQuery.data],
  );

  const activePositions: PositionItem[] = useMemo(() => {
    if (!portfolio?.positions?.length || !address) return [];
    return portfolio.positions.flatMap((position) => {
      const money = mapHonestOpenPositionMoney(
        withRebuiltCostBasis(position, address, portfolio.fills ?? []),
      );
      if (!money) return [];
      const yesHeld = position.balanceYes > 0n;
      const quantityRaw = yesHeld ? position.balanceYes : position.balanceNo;
      if (quantityRaw <= 0n) return [];
      return [{
        marketId: position.market.id,
        poolAddress: position.market.poolAddress,
        quoteDecimals: position.market.quoteDecimals,
        sellSide: yesHeld ? 'SELL_YES' as const : 'SELL_NO' as const,
        quantityRaw,
        title: position.market.question
          || (position.market.asset && position.market.interval
            ? `${position.market.asset} ${position.market.interval}`
            : shorten(position.market.marketAddress || position.market.id)),
        whaleAddress: null,
        outcome: yesHeld ? 'YES' : 'NO',
        stake: money.stakeHuman,
        shares: money.sharesHuman,
        currentValue: money.markHuman,
        pnl: money.unrealizedPnlHuman,
        costBasisUnknown: money.costBasisUnknown,
        timestamp: position.market.expiry ?? '',
        status: 'OPEN' as const,
      }];
    });
  }, [portfolio, address]);

  const fillCount = portfolio?.fills?.length ?? 0;
  const hasAnyActivity = activePositions.length > 0 || fillCount > 0;
  const totalUnrealized = activePositions.reduce(
    (sum, p) => sum + (p.pnl ?? 0),
    0,
  );
  const hasUnknownCostBasis = activePositions.some((p) => p.costBasisUnknown);

  // Same source Settings uses — /api/follow-rules (KV or local file store).
  const followRulesQuery = useQuery({
    queryKey: [FOLLOW_RULES_QUERY_KEY, address],
    queryFn: () => fetchFollowRules(address!),
    enabled: hasWalletSession && !!address,
    staleTime: 30_000,
    retry: 1,
  });
  const followRules = followRulesQuery.data?.rules ?? [];
  const whalesMonitored = countMonitoredWhales(followRules);

  const totalEntries = activePositions.length;
  const paginatedPositions = activePositions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handleManagePosition = (pos: PositionItem) => {
    setSelectedPosition(pos);
    setManageModalOpen(true);
  };

  const handleClosePosition = useCallback(async (_marketId: string) => {
    if (!selectedPosition) throw new Error('No position selected');
    if (!selectedPosition.poolAddress) {
      throw new Error('Pool address missing for this market; cannot place sell');
    }
    const result = await closePosition.mutateAsync({
      pool: selectedPosition.poolAddress,
      side: selectedPosition.sellSide,
      quantity: selectedPosition.quantityRaw,
      quoteDecimals: selectedPosition.quoteDecimals,
    });
    if (result.partial) {
      // Still closed what the book could absorb; surface via console for QA.
      console.warn(
        `[close] Partial unwind: fillable ${result.fillableQuantity} of ${result.quantity}`,
      );
    }
  }, [selectedPosition, closePosition]);

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
                  !hasAnyActivity || (hasUnknownCostBasis && activePositions.every((pos) => pos.pnl === null))
                    ? 'text-[var(--text-secondary)]'
                    : totalUnrealized >= 0
                      ? 'text-[var(--green)]'
                      : 'text-[var(--red)]'
                }`}>
                  {!hasAnyActivity || (hasUnknownCostBasis && activePositions.every((pos) => pos.pnl === null))
                    ? '—'
                    : `${totalUnrealized >= 0 ? '+' : ''}$${totalUnrealized.toFixed(2)}`}
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-2">
                {!hasAnyActivity
                  ? 'No copied trades yet'
                  : hasUnknownCostBasis
                    ? 'Some stakes unavailable (incomplete cost basis)'
                    : 'From live open positions'}
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
                <div className={`stat-value ${whalesMonitored === 0 ? 'text-[var(--text-secondary)]' : ''}`}>
                  {whalesMonitored}
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-2">
                {followRulesQuery.isLoading
                  ? 'Loading saved rules…'
                  : followRulesQuery.isError
                    ? 'Could not load saved rules'
                    : whalesMonitored === 0
                      ? NO_WHALES_FOLLOWED_YET
                      : `${whalesMonitored} saved auto-copy rule${whalesMonitored === 1 ? '' : 's'}`}
              </p>
            </div>
          </div>

          <div className="card animate-in delay-2">
            <div className="card-header flex flex-row items-center justify-between">
              <div>
                <h3 className="card-title">Portfolio Growth</h3>
                <p className="card-desc">Cumulative settled PnL from indexed market history</p>
              </div>
              <span className="badge badge-outline">
                {equityQuery.isLoading
                  ? 'Loading…'
                  : equityDataPoints.length > 0
                    ? `${equityDataPoints.length} settlements`
                    : fillCount > 0
                      ? `${fillCount} fills`
                      : 'No data'}
              </span>
            </div>
            <div className="card-body mt-2">
              {equityQuery.isError ? (
                <div className="text-center py-10 text-sm text-[var(--red)]">
                  {equityQuery.error?.message ?? 'Unable to load equity history'}
                </div>
              ) : equityQuery.isLoading ? (
                <div className="flex items-center justify-center py-10 text-[var(--text-muted)] text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Loading settled PnL history…
                </div>
              ) : equityDataPoints.length > 0 ? (
                <EquityCurve data={equityDataPoints} height={220} chartId="performanceCurve" />
              ) : (
                <div className="text-center py-10 text-[var(--text-muted)] text-sm">
                  {fillCount > 0
                    ? 'No settled market PnL yet for this wallet — curve appears after resolved markets with attributed fills.'
                    : 'No copied trades yet. Equity curve appears after settled fills are indexed for this wallet.'}
                </div>
              )}
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
                    <th className="right">Shares</th>
                    <th className="right">Stake</th>
                    <th className="right">Current Value</th>
                    <th className="right">PnL</th>
                    <th className="right">Status</th>
                    <th className="right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPositions.map((pos) => {
                    const isPositive = pos.pnl !== null && pos.pnl >= 0;
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
                        <td className="right mono">{formatSharesHuman(pos.shares)}</td>
                        <td
                          className="right mono"
                          title={pos.costBasisUnknown ? 'Cost basis unavailable (incomplete fill reconstruction)' : undefined}
                        >
                          {formatOpenPositionMoney(pos.stake)}
                        </td>
                        <td className="right mono">{formatOpenPositionMoney(pos.currentValue)}</td>
                        <td className={`right mono font-semibold ${
                          pos.pnl === null ? '' : isPositive ? 'green' : 'red'
                        }`}>
                          {formatOpenPositionMoney(pos.pnl, { signed: true })}
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
        onClosePosition={handleClosePosition}
      />
    </div>
  );
}
