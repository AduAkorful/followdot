'use client';

import { useMemo, useState } from 'react';
import { useWhaleProfile } from '@/hooks/use-whale-profile';
import { useCopyOrder } from '@/hooks/use-copy-order';
import { CopyOrderModal } from '@/components/copy-order-modal';
import { EquityCurve } from '@/components/equity-curve';
import { ArrowLeft, Loader2, AlertCircle, Copy, Check, Play } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { BinarySide } from '@somnia-chain/markets-sdk';

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function avatarInitials(addr: string): string {
  return addr.slice(2, 4).toUpperCase();
}

function formatPnL(pnl: number): string {
  const sign = pnl >= 0 ? '+' : '';
  if (Math.abs(pnl) >= 1000) return `${sign}${(pnl / 1000).toFixed(1)}k`;
  return `${sign}${pnl.toFixed(2)}`;
}

export default function WhaleProfile() {
  const params = useParams<{ address: string }>();
  const address = params?.address ?? '';
  const { data, isLoading, isError, error } = useWhaleProfile(address);

  const [copyOpen, setCopyOpen] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<{
    pool: string;
    side: BinarySide;
  } | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyHash, setCopyHash] = useState<string | null>(null);
  const copyOrder = useCopyOrder();

  const equityDataPoints = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.marketPnL].sort((a, b) => {
      const aTs = data.fills.find((f) => f.market === a.marketId)?.timestamp ?? '0';
      const bTs = data.fills.find((f) => f.market === b.marketId)?.timestamp ?? '0';
      return Number(aTs) - Number(bTs);
    });
    let running = 0;
    return sorted.map((m, idx) => {
      running += m.pnl;
      const ts = data.fills.find((f) => f.market === m.marketId)?.timestamp;
      return { timestamp: ts ? Number(ts) : idx, pnl: running };
    });
  }, [data]);

  const handleCopyClick = (pool: string, side: BinarySide) => {
    setSelectedMarket({ pool, side });
    setCopyOpen(true);
  };

  const handlePlaceOrder = async (params: {
    bankrollPct: number;
    maxNotionalUSD: number;
    slippageTolerance: number;
  }): Promise<string> => {
    if (!selectedMarket) throw new Error('No market selected');
    setCopyError(null);
    setCopyHash(null);
    try {
      const stake = BigInt(Math.max(1, Math.floor(params.maxNotionalUSD * params.bankrollPct)));
      const slippageBps = Math.max(0, Math.round(params.slippageTolerance * 10_000));
      const result = await copyOrder.mutateAsync({
        pool: selectedMarket.pool,
        whaleSide: selectedMarket.side,
        stake,
        slippageBps,
      });
      setCopyHash(result.hash);
      return result.hash;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Copy order failed';
      setCopyError(msg);
      throw err;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-[var(--text-muted)]">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading whale profile…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-24 text-[var(--red)]">
        <AlertCircle className="h-5 w-5 mr-2" /> Failed to load whale profile: {error?.message}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-24 text-[var(--text-muted)]">
        No profile data found for address {address}.
      </div>
    );
  }

  const s = data.score;
  const winRatePct = Math.round(s.winRate * 100);
  const scorePct = Math.round(s.score * 100);
  const isPositivePnL = s.totalRealizedPnL >= 0;
  const sortedFills = [...(data.fills ?? [])].sort(
    (a, b) => Number(b.timestamp) - Number(a.timestamp),
  );

  const firstCopyMarket = data.marketPnL.find((m) => m.marketAddress);

  return (
    <div className="space-y-6">
      <Link href="/" className="back-link animate-in">
        <ArrowLeft className="w-4 h-4" /> Back to Leaderboard
      </Link>

      {/* Profile Header */}
      <div className="profile-header animate-in delay-1">
        <div className="profile-info">
          <div className="profile-avatar">
            {avatarInitials(s.address)}
          </div>
          <div>
            <h2 className="profile-name flex items-center gap-2">
              {shortenAddress(s.address)}
              <span className="badge badge-accent font-mono text-xs">
                Ranked Whale
              </span>
            </h2>
            <div className="profile-address">{s.address}</div>
            <div className="profile-meta">
              {scorePct}% Skill Score · {winRatePct}% Win Rate across {s.totalMarkets} settled markets
            </div>
          </div>
        </div>

        <div className="profile-actions">
          <button
            onClick={() => setIsFollowing(!isFollowing)}
            className={`btn ${isFollowing ? 'btn-accent' : 'btn-outline'}`}
          >
            {isFollowing ? <Check className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" />}
            {isFollowing ? 'Auto-Following' : 'Auto-Follow'}
          </button>

          <button
            onClick={() => handleCopyClick(firstCopyMarket?.marketAddress ?? '', 'BUY_YES')}
            disabled={!firstCopyMarket}
            className="btn btn-accent disabled:opacity-40"
          >
            <Copy className="w-4 h-4 mr-1" />
            1-Click Copy
          </button>
        </div>
      </div>

      {copyHash && (
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border-accent)] rounded-lg flex items-center gap-3 animate-in">
          <Check className="w-5 h-5 text-[var(--green)] shrink-0" />
          <div className="text-sm">
            <span className="font-semibold text-[var(--green)] font-mono">Copy order submitted!</span> Tx Hash:{' '}
            <code className="font-mono text-xs text-[var(--accent)]">
              {copyHash.slice(0, 14)}…{copyHash.slice(-8)}
            </code>
          </div>
        </div>
      )}

      {copyError && (
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--red)] rounded-lg flex items-center gap-3 animate-in text-[var(--red)]">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div className="text-sm font-mono">{copyError}</div>
        </div>
      )}

      {/* Top 3 KPI Cards */}
      <div className="grid-3 animate-in delay-2">
        <div className="stat-card">
          <div className="stat-label">Bayesian Skill Score</div>
          <div className="stat-row">
            <div className="stat-value text-[var(--accent)]">{scorePct}%</div>
            <span className="stat-trend up">Top 5%</span>
          </div>
          <div className="score-bar mt-3">
            <div className="score-bar-fill" style={{ width: `${scorePct}%` }} />
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Realized PnL</div>
          <div className="stat-row">
            <div className={`stat-value ${isPositivePnL ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
              {formatPnL(s.totalRealizedPnL)} USDC
            </div>
            <span className={`stat-trend ${isPositivePnL ? 'up' : 'down'}`}>
              {isPositivePnL ? '↑' : '↓'} PnL
            </span>
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-3 font-mono">
            Settled Markets: {s.totalMarkets}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Consistency Factor</div>
          <div className="stat-row">
            <div className="stat-value">{Math.round(s.consistencyFactor * 100)}%</div>
            <span className="stat-trend up">Consistent</span>
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-3 font-mono">
            {s.consistencyFactor >= 0.5 ? 'Low Variance Edge' : 'High Volatility'}
          </div>
        </div>
      </div>

      {/* Equity Curve Chart Card */}
      <div className="card animate-in delay-3">
        <div className="card-header flex flex-row items-center justify-between">
          <div>
            <h3 className="card-title">Trader Cumulative PnL</h3>
            <p className="card-desc">Realized equity curve over settled binary market fills</p>
          </div>
          <span className="badge badge-accent font-mono text-xs">
            {equityDataPoints.length} Settlements
          </span>
        </div>
        <div className="card-body mt-2">
          <EquityCurve data={equityDataPoints} height={220} chartId="whaleProfileCurve" />
        </div>
      </div>

      {/* Category Breakdown & Per-Market Table Grid */}
      <div className="grid-2 animate-in delay-4">
        {/* Category Breakdown */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Win Rate by Category</h3>
            <p className="card-desc">Specialization across market types</p>
          </div>
          <div className="card-body mt-2 space-y-4">
            {(data.winRateByMarketType ?? []).map((mt) => {
              const pct = Math.round(mt.winRate * 100);
              return (
                <div key={mt.marketType} className="progress-row">
                  <div className="progress-label">
                    <span>{mt.marketType}</span>
                    <span>{mt.wins}W / {mt.total} total ({pct}%)</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {(data.winRateByMarketType ?? []).length === 0 && (
              <div className="text-sm text-[var(--text-muted)] py-4 text-center">
                No category breakdown recorded yet.
              </div>
            )}
          </div>
        </div>

        {/* Per-Market PnL Table */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Resolved Markets Edge</h3>
            <p className="card-desc">PnL per prediction market</p>
          </div>
          <div className="card-body p-0 mt-2 overflow-x-auto">
            {data.marketPnL.length === 0 ? (
              <div className="text-sm text-[var(--text-muted)] py-8 text-center">
                No resolved markets found.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Type</th>
                    <th className="right">Trades</th>
                    <th className="right">PnL</th>
                    <th className="right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.marketPnL]
                    .sort((a, b) => b.tradeCount - a.tradeCount)
                    .slice(0, 5)
                    .map((m) => {
                      const side: BinarySide = (data.fills.find((f) => f.market === m.marketId)?.takerSide ?? 'BUY_YES');
                      return (
                        <tr key={m.marketId}>
                          <td className="mono text-xs font-medium">
                            {shortenAddress(m.marketAddress || m.marketId)}
                          </td>
                          <td>
                            <span className="badge badge-outline">{m.marketType}</span>
                          </td>
                          <td className="right mono text-xs">{m.tradeCount}</td>
                          <td className={`right mono font-semibold ${m.pnl >= 0 ? 'green' : 'red'}`}>
                            {formatPnL(m.pnl)}
                          </td>
                          <td className="right">
                            <button
                              onClick={() => handleCopyClick(m.marketAddress, side)}
                              disabled={!m.marketAddress}
                              className="btn btn-accent btn-sm disabled:opacity-40"
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
          </div>
        </div>
      </div>

      {/* Recent Fills Table */}
      <div className="card animate-in delay-5">
        <div className="card-header">
          <h3 className="card-title">Recent On-Chain Fills</h3>
          <p className="card-desc">Individual order execution history</p>
        </div>
        <div className="card-body p-0 mt-4 overflow-x-auto">
          {!data.fills || data.fills.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)]">No trade fills recorded.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Timestamp</th>
                  <th>Side</th>
                  <th className="right">Quantity</th>
                  <th className="right">Price</th>
                </tr>
              </thead>
              <tbody>
                {sortedFills.slice(0, 15).map((f) => (
                  <tr key={f.id}>
                    <td className="mono text-xs font-medium">{shortenAddress(f.market)}</td>
                    <td className="mono text-xs text-[var(--text-muted)]">
                      {f.timestamp ? new Date(Number(f.timestamp) * 1000).toLocaleString() : '—'}
                    </td>
                    <td>
                      <span className="badge badge-accent">
                        {f.takerSide ?? (f.takerIsBid ? 'BUY' : 'SELL')}
                      </span>
                    </td>
                    <td className="right mono text-xs">
                      {f.quantity ? Number(f.quantity).toFixed(2) : '—'}
                    </td>
                    <td className="right mono font-semibold text-[var(--accent)]">
                      {f.fillPrice ? `$${Number(f.fillPrice).toFixed(4)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedMarket && (
        <CopyOrderModal
          open={copyOpen}
          onOpenChange={setCopyOpen}
          whaleAddress={data.address}
          onPlaceOrder={handlePlaceOrder}
        />
      )}
    </div>
  );
}
