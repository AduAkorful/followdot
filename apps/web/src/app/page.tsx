'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useWhaleLeaderboard } from '@/hooks/use-whales';
import { useCopyOrder } from '@/hooks/use-copy-order';
import { Sparkline } from '@/components/sparkline';
import { Pagination } from '@/components/pagination';
import { CopyOrderModal } from '@/components/copy-order-modal';
import { Search, Loader2, AlertCircle } from 'lucide-react';

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
  const { data: whales = [], isLoading, isError, error } = useWhaleLeaderboard(50);
  const copyOrder = useCopyOrder();
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [selectedWhale, setSelectedWhale] = useState<string | null>(null);

  const filtered = search
    ? whales.filter((w) => w.address.toLowerCase().includes(search.toLowerCase()))
    : whales;

  const totalEntries = filtered.length;
  const paginatedWhales = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const avgSkillScore = whales.length
    ? Math.round((whales.reduce((acc, w) => acc + w.score, 0) / whales.length) * 100)
    : 0;

  const totalVolume = whales.reduce((acc, w) => acc + Math.abs(w.totalRealizedPnL || 0), 0);
  const formatVol = (v: number) => {
    if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
  };

  const handleOpenCopy = (address: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedWhale(address);
    setCopyModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h2 className="page-title">Whale Leaderboard</h2>
        <p className="page-subtitle">
          Top traders ranked by Bayesian skill score — consistent edge, not raw PnL.
        </p>
      </div>

      {/* KPI Stat Cards */}
      <div className="stats-row animate-in delay-1">
        <div className="stat-card">
          <div className="stat-label">Whales Tracked</div>
          <div className="stat-row">
            <div className="stat-value">{whales.length}</div>
            <span className="stat-trend up">{whales.length > 0 ? 'Live' : '0'}</span>
          </div>
          <Sparkline trend="up" height={32} id="stat1" data={whales.map(w => w.score * 100)} />
        </div>

        <div className="stat-card">
          <div className="stat-label">Avg Skill Score</div>
          <div className="stat-row">
            <div className="stat-value">
              {avgSkillScore}
              <span className="text-base text-[var(--text-muted)]">%</span>
            </div>
            <span className="stat-trend up">{whales.length > 0 ? 'Live' : '0%'}</span>
          </div>
          <Sparkline trend="up" height={32} id="stat2" data={whales.map(w => w.score * 100)} />
        </div>

        <div className="stat-card">
          <div className="stat-label">Volume Mirrored</div>
          <div className="stat-row">
            <div className="stat-value">{formatVol(totalVolume)}</div>
            <span className="stat-trend up">{totalVolume > 0 ? 'Live' : '$0'}</span>
          </div>
          <Sparkline trend="up" height={32} id="stat3" data={whales.map(w => Math.abs(w.totalRealizedPnL))} />
        </div>

        <div className="stat-card">
          <div className="stat-label">Active Copiers</div>
          <div className="stat-row">
            <div className="stat-value">0</div>
            <span className="stat-trend up">0</span>
          </div>
          <Sparkline trend="up" height={32} id="stat4" data={[0, 0]} />
        </div>
      </div>

      {/* Main Leaderboard Table */}
      <div className="card animate-in delay-2">
        <div className="card-header flex flex-row items-center justify-between">
          <div>
            <h3 className="card-title">Top Whales by Skill</h3>
            <p className="card-desc">Rankings update automatically with settled market outcomes</p>
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
          {isLoading && (
            <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Indexing on-chain market fills…
            </div>
          )}

          {isError && (
            <div className="flex items-center justify-center py-12 text-[var(--red)]">
              <AlertCircle className="h-5 w-5 mr-2" />
              Failed to load leaderboard: {error?.message}
            </div>
          )}

          {!isLoading && !isError && filtered.length === 0 && (
            <div className="text-center py-16 text-[var(--text-muted)]">
              {search ? 'No wallets match your search.' : 'No active whales found on Somnia testnet.'}
            </div>
          )}

          {!isLoading && !isError && filtered.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>Rank</th>
                  <th>Trader</th>
                  <th>Skill Score</th>
                  <th className="right">Win Rate</th>
                  <th className="right">Settled Markets</th>
                  <th className="right">Realized PnL</th>
                  <th className="right" style={{ width: '100px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedWhales.map((whale, idx) => {
                  const globalRank = (currentPage - 1) * pageSize + idx + 1;
                  const scorePct = Math.round(whale.score * 100);
                  const winRatePct = Math.round(whale.winRate * 100);
                  const pnlStr = formatPnL(whale.totalRealizedPnL);
                  const isPositive = whale.totalRealizedPnL >= 0;

                  let rankClass = 'rank';
                  if (globalRank === 1) rankClass += ' gold';
                  else if (globalRank === 2) rankClass += ' silver';
                  else if (globalRank === 3) rankClass += ' bronze';

                  return (
                    <tr key={whale.address}>
                      <td>
                        <span className={rankClass}>#{globalRank}</span>
                      </td>
                      <td>
                        <Link
                          href={`/whale/${whale.address}`}
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
                      <td>
                        <div className="score-bar-wrapper">
                          <div className="score-bar">
                            <div
                              className="score-bar-fill"
                              style={{ width: `${Math.max(5, scorePct)}%` }}
                            />
                          </div>
                          <span className="score-bar-value">{scorePct}%</span>
                        </div>
                      </td>
                      <td className="right mono font-semibold">{winRatePct}%</td>
                      <td className="right mono text-[var(--text-secondary)]">{whale.totalMarkets}</td>
                      <td className={`right mono font-semibold ${isPositive ? 'green' : 'red'}`}>
                        {pnlStr} USDC
                      </td>
                      <td className="right">
                        <button
                          onClick={(e) => handleOpenCopy(whale.address, e)}
                          className="btn btn-accent btn-sm"
                        >
                          Copy
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {!isLoading && !isError && totalEntries > 0 && (
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

      {/* Copy Modal */}
      {selectedWhale && (
        <CopyOrderModal
          open={copyModalOpen}
          onOpenChange={setCopyModalOpen}
          whaleAddress={selectedWhale}
          onPlaceOrder={async (params) => {
            const stake = BigInt(Math.max(1, Math.floor(params.maxNotionalUSD * params.bankrollPct)));
            const slippageBps = Math.max(0, Math.round(params.slippageTolerance * 10_000));
            const result = await copyOrder.mutateAsync({
              pool: selectedWhale,
              whaleSide: 'BUY_YES',
              stake,
              slippageBps,
            });
            return result.hash;
          }}
        />
      )}
    </div>
  );
}
