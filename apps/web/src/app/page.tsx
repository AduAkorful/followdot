'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useWhaleLeaderboard } from '@/hooks/use-whales';
import { Sparkline } from '@/components/sparkline';
import { Pagination } from '@/components/pagination';
import { formatSignedUsd, formatSnapshotLabel, sumNetRealizedPnL } from '@/lib/whale-display';
import { Search, Loader2, AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function avatarInitials(addr: string): string {
  return addr.slice(2, 4).toUpperCase();
}

function formatPnL(pnl: number): string {
  const sign = pnl >= 0 ? '+' : '';
  if (Math.abs(pnl) >= 1000) {
    return `${sign}${(pnl / 1000).toFixed(1)}k`;
  }
  return `${sign}${pnl.toFixed(2)}`;
}

export default function Home() {
  const { data, isLoading, isFetching, isError, error, refetch, isRefetching } = useWhaleLeaderboard(20);
  const whales = data?.whales ?? [];
  const snapshotLabel = formatSnapshotLabel(data?.generatedAt);
  const isPartial = data?.partial === true;
  // Show skeleton only while the first attempt is in flight — never on error.
  const showInitialSkeleton = isLoading && !isError && whales.length === 0;
  const showLoadError = isError && whales.length === 0;
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState<'skill' | 'calibration'>('skill');
  const pageSize = 10;

  /** Skill-order ranks for profile deep-links (stable even when table sorted by calibration). */
  const skillRankByAddress = useMemo(() => {
    const byScore = [...whales].sort((a, b) => b.score - a.score);
    return new Map(byScore.map((w, i) => [w.address.toLowerCase(), i + 1]));
  }, [whales]);

  const filteredByAddress = search
    ? whales.filter((w) => w.address.toLowerCase().includes(search.toLowerCase()))
    : whales;
  const filtered = [...filteredByAddress].sort((a, b) => {
    if (sortBy === 'calibration') {
      if (a.calibrationScore === null) return 1;
      if (b.calibrationScore === null) return -1;
      return b.calibrationScore - a.calibrationScore;
    }
    return b.score - a.score;
  });

  const totalEntries = filtered.length;
  const paginatedWhales = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const avgSkillScore = whales.length
    ? Math.round((whales.reduce((acc, w) => acc + w.score, 0) / whales.length) * 100)
    : 0;

  const netRealizedPnL = sumNetRealizedPnL(whales.map((w) => w.totalRealizedPnL));

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h2 className="page-title">Whale Leaderboard</h2>
        <p className="page-subtitle">
          Top traders ranked by Bayesian skill on the <strong>recent fill window</strong> — not full wallet history.
          {snapshotLabel ? (
            <span className="block mt-1 text-xs text-[var(--text-muted)] font-normal">
              Snapshot {snapshotLabel}
              {isPartial ? ' · partial (cold budget)' : ''}
            </span>
          ) : isPartial ? (
            <span className="block mt-1 text-xs text-[var(--text-muted)] font-normal">
              Partial snapshot — cold path finished under time budget
            </span>
          ) : null}
        </p>
      </div>

      {/* KPI Stat Cards */}
      <div className="stats-row animate-in delay-1">
        <div className="stat-card">
          <div className="stat-label">Whales Tracked</div>
          <div className="stat-row">
            <div className="stat-value">{whales.length > 0 ? whales.length : '—'}</div>
            <span className="stat-trend up">{whales.length > 0 ? 'Live' : (isLoading ? 'Loading' : 'Empty')}</span>
          </div>
          <Sparkline trend="up" height={32} id="stat1" data={whales.map(w => w.score * 100)} />
        </div>

        <div className="stat-card">
          <div className="stat-label">Avg Skill Score</div>
          <div className="stat-row">
            <div className="stat-value">
              {whales.length > 0 ? avgSkillScore : '—'}
              {whales.length > 0 && <span className="text-base text-[var(--text-muted)]">%</span>}
            </div>
            <span className="stat-trend up">{whales.length > 0 ? 'Live' : (isLoading ? 'Loading' : 'Empty')}</span>
          </div>
          <Sparkline trend="up" height={32} id="stat2" data={whales.map(w => w.score * 100)} />
        </div>

        <div
          className="stat-card"
          title="Net realized PnL across tracked whales (losses offset gains)."
        >
          <div className="stat-label">Indexed Realized PnL</div>
          <div className="stat-row">
            <div className={`stat-value ${whales.length > 0 && netRealizedPnL < 0 ? 'text-[var(--red)]' : ''}`}>
              {whales.length > 0 ? formatSignedUsd(netRealizedPnL) : '—'}
            </div>
            <span className={`stat-trend ${whales.length > 0 ? (netRealizedPnL >= 0 ? 'up' : 'down') : 'neutral'}`}>
              {whales.length > 0 ? 'Net' : (isLoading ? 'Loading' : 'Empty')}
            </span>
          </div>
          <Sparkline
            trend={netRealizedPnL >= 0 ? 'up' : 'down'}
            height={32}
            id="stat3"
            data={whales.map((w) => w.totalRealizedPnL)}
          />
          <div className="text-xs text-[var(--text-muted)] mt-2">
            Net sum · losses offset gains
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Active Copiers</div>
          <div className="stat-row">
            <div className="stat-value text-base">—</div>
            <span className="badge badge-outline">N/A</span>
          </div>
        </div>
      </div>

      {/* Main Leaderboard Table */}
      <div className="card animate-in delay-2">
        <div className="card-header flex flex-row items-center justify-between">
          <div>
            <h3 className="card-title">Top Whales by Skill</h3>
            <p className="card-desc">
              Recent-window skill (discovery fills). Profile pages use deeper history and may differ.
            </p>
          </div>
          <div className="search-box w-64">
            <Search />
            <input
              type="text"
              placeholder="Search address..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>

        <div className="card-body p-0 mt-4 overflow-x-auto">
          {isFetching && whales.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Refreshing leaderboard…
            </div>
          )}

          {showInitialSkeleton && (
            <div className="p-4 space-y-3" aria-busy="true" aria-label="Loading whale leaderboard">
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] mb-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading cached leaderboard from indexer…
              </div>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-8 bg-[var(--surface-2)]" />
                  <Skeleton className="h-8 w-8 rounded-full bg-[var(--surface-2)]" />
                  <Skeleton className="h-4 flex-1 bg-[var(--surface-2)]" />
                  <Skeleton className="h-4 w-16 bg-[var(--surface-2)]" />
                  <Skeleton className="h-4 w-20 bg-[var(--surface-2)]" />
                </div>
              ))}
            </div>
          )}

          {showLoadError && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-[var(--red)]">
              <div className="flex items-center">
                <AlertCircle className="h-5 w-5 mr-2 shrink-0" />
                <span>{error?.message ?? 'Failed to load leaderboard'}</span>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={isRefetching}
                onClick={() => { void refetch(); }}
              >
                {isRefetching ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}

          {isError && whales.length > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs border-b border-[var(--red)]/40 text-[var(--red)]">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                Refresh failed: {error?.message ?? 'unknown error'}
              </span>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={isRefetching}
                onClick={() => { void refetch(); }}
              >
                Retry
              </button>
            </div>
          )}

          {!showInitialSkeleton && !showLoadError && filtered.length === 0 && (
            <div className="text-center py-16 text-[var(--text-muted)]">
              {search ? 'No wallets match your search.' : 'No active whales found on Somnia testnet.'}
            </div>
          )}

          {!showInitialSkeleton && filtered.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>Rank</th>
                  <th>Trader</th>
                  <th>
                    <button type="button" onClick={() => setSortBy('skill')} className="hover:text-[var(--accent)]">
                      Skill Score{sortBy === 'skill' ? ' ↓' : ''}
                    </button>
                  </th>
                  <th className="right">Win Rate</th>
                  <th className="right">Settled Markets</th>
                  <th className="right">Realized PnL</th>
                  <th className="right">
                    <button type="button" onClick={() => setSortBy('calibration')} className="hover:text-[var(--accent)]">
                      Calibration{sortBy === 'calibration' ? ' ↓' : ''}
                    </button>
                  </th>
                  <th className="right" style={{ width: '100px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedWhales.map((whale, idx) => {
                  const displayRank = (currentPage - 1) * pageSize + idx + 1;
                  const skillRank = skillRankByAddress.get(whale.address.toLowerCase()) ?? displayRank;
                  const profileHref = `/whale/${whale.address}?rank=${skillRank}&total=${whales.length}`;
                  const scorePct = Math.round(whale.score * 100);
                  const winRatePct = Math.round(whale.winRate * 100);
                  const pnlStr = formatPnL(whale.totalRealizedPnL);
                  const isPositive = whale.totalRealizedPnL >= 0;

                  let rankClass = 'rank';
                  if (skillRank === 1) rankClass += ' gold';
                  else if (skillRank === 2) rankClass += ' silver';
                  else if (skillRank === 3) rankClass += ' bronze';

                  return (
                    <tr key={whale.address}>
                      <td>
                        <span className={rankClass}>#{sortBy === 'skill' ? skillRank : displayRank}</span>
                      </td>
                      <td>
                        <Link
                          href={profileHref}
                          className="flex items-center gap-3 hover:text-[var(--accent)] transition-colors"
                        >
                          <div className="profile-avatar !w-8 !h-8 !text-xs">
                            {avatarInitials(whale.address)}
                          </div>
                          <div>
                            <div className="font-medium font-mono text-sm">
                              {shortenAddress(whale.address)}
                            </div>
                            <div className="text-xs text-[var(--text-muted)]">
                              {whale.consistencyFactor >= 0.5 ? 'High Edge' : 'Standard Edge'}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td title="Recent fill-window skill (not full profile history)">
                        <div className="score-bar-wrapper">
                          <div className="score-bar">
                            <div
                              className="score-bar-fill"
                              style={{ width: `${Math.max(5, scorePct)}%` }}
                            />
                          </div>
                          <span className="score-bar-value">{scorePct}%</span>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] mt-0.5">recent window</div>
                      </td>
                      <td className="right mono font-semibold">{winRatePct}%</td>
                      <td className="right mono text-[var(--text-secondary)]">{whale.totalMarkets}</td>
                      <td className={`right mono font-semibold ${isPositive ? 'green' : 'red'}`}>
                        {pnlStr} USDC
                      </td>
                      <td className="right mono">
                        {whale.calibrationScore === null ? 'unavailable' : `${Math.round(whale.calibrationScore * 100)}%`}
                      </td>
                      <td className="right">
                        <Link href={profileHref} className="btn btn-accent btn-sm">
                          View profile
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {!showInitialSkeleton && totalEntries > 0 && (
            <Pagination
              currentPage={currentPage}
              totalItems={totalEntries}
              pageSize={pageSize}
              onPageChange={(page) => setCurrentPage(page)}
            />
          )}
        </div>
      </div>

      {/* Recent Copied Trades Activity Stream */}
      <div className="card animate-in delay-3">
        <div className="card-header">
          <h3 className="card-title">Recent Copied Trades Stream</h3>
          <p className="card-desc">Live activity mirrored across all copiers</p>
        </div>
        <div className="card-body">
          <div className="text-center py-8 text-[var(--text-muted)] text-sm">
            No active copied trade stream detected.
          </div>
        </div>
      </div>

    </div>
  );
}
