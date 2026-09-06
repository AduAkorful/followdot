'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useAccount } from 'wagmi';
import { useWhaleProfile, useWhaleProfileAnalytics } from '@/hooks/use-whale-profile';
import { useWhaleLeaderboard } from '@/hooks/use-whales';
import { mergeWhaleProfile } from '@/lib/whale-profile';
import { resolveConsistencyDisplay, resolveRankDisplay } from '@/lib/whale-display';
import { useCopyOrder } from '@/hooks/use-copy-order';
import { CopyOrderModal } from '@/components/copy-order-modal';
import { EquityCurve } from '@/components/equity-curve';
import {
  buildEquityCurvePoints,
  countEquityCurveSettlements,
  selectSettledEquityMarkets,
} from '@/lib/equity-curve-data';
import { EdgeAnalysisScatter } from '@/components/edge-analysis-scatter';
import { ArrowLeft, Loader2, AlertCircle, Copy, Check, Play } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import type { BinarySide } from '@somnia-chain/markets-sdk';
import {
  formatFillPrice,
  formatFillQuantity,
  resolveFillQuoteDecimals,
} from '@/lib/format-fill';
import {
  formatOpenPositionMoney,
  formatSharesHuman,
} from '@/lib/open-position-display';
import {
  FOLLOW_RULES_QUERY_KEY,
  fetchFollowRules,
  saveFollowRule,
  type AutoCopyRule,
} from '@/lib/follow-rules';
import { useQuery, useQueryClient } from '@tanstack/react-query';

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

function formatEdge(bps: number | null): string {
  if (bps === null) return '—';
  const sign = bps > 0 ? '+' : '';
  return `${sign}${bps.toFixed(0)} bps`;
}

function AnalyticsGate({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading analytics…
      </div>
    );
  }
  if (error) {
    const timedOut = /504|timeout|timed out/i.test(error.message);
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 px-4 text-center">
        <div className="flex items-center justify-center text-[var(--red)]">
          <AlertCircle className="h-5 w-5 mr-2 shrink-0" />
          <span className="text-sm">
            {timedOut
              ? 'Analytics timed out (504). This is a failed request, not empty data.'
              : `Analytics unavailable: ${error.message}`}
          </span>
        </div>
        <button type="button" onClick={onRetry} className="btn btn-outline btn-sm">
          Retry analytics
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

function AnalyticsBanner({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center px-4 py-3 text-sm text-[var(--text-muted)] border-b border-[var(--border)]">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading fill analytics…
      </div>
    );
  }
  if (error) {
    const timedOut = /504|timeout|timed out/i.test(error.message);
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--red)] border-b border-[var(--border)]">
        <span className="flex items-center">
          <AlertCircle className="h-4 w-4 mr-2 shrink-0" />
          {timedOut
            ? 'Analytics timed out (504) — edge figures are unavailable, not empty.'
            : `Analytics failed: ${error.message}`}
        </span>
        <button type="button" onClick={onRetry} className="btn btn-outline btn-sm shrink-0">
          Retry
        </button>
      </div>
    );
  }
  return null;
}

export default function WhaleProfile() {
  const params = useParams<{ address: string }>();
  const searchParams = useSearchParams();
  const address = params?.address ?? '';
  const { data: coreData, isLoading, isError, error } = useWhaleProfile(address);
  const {
    data: analytics,
    isLoading: analyticsLoading,
    isFetching: analyticsFetching,
    isError: analyticsIsError,
    error: analyticsError,
    refetch: refetchAnalytics,
  } = useWhaleProfileAnalytics(address, !!coreData);
  const data = coreData
    ? mergeWhaleProfile(coreData, analytics ?? null)
    : undefined;
  const retryAnalytics = () => { void refetchAnalytics(); };
  const showAnalyticsLoading = analyticsLoading || (analyticsFetching && !analytics);
  const showAnalyticsError = analyticsIsError && !analytics && !showAnalyticsLoading;
  const analyticsFailure = showAnalyticsError ? (analyticsError ?? new Error('Analytics request failed')) : null;

  const rankFromQuery = Number(searchParams?.get('rank') ?? '');
  const totalFromQuery = Number(searchParams?.get('total') ?? '');
  const queryRank = Number.isInteger(rankFromQuery) && rankFromQuery > 0 ? rankFromQuery : null;
  const queryTotal = Number.isInteger(totalFromQuery) && totalFromQuery > 0 ? totalFromQuery : null;

  // Prefer query params from LB links; fall back to cached leaderboard so
  // "View profile" / refresh don't falsely show Unranked for a ranked whale.
  const { data: leaderboard } = useWhaleLeaderboard(20);
  const lbLookup = useMemo(() => {
    const list = leaderboard?.whales ?? [];
    const idx = list.findIndex((w) => w.address.toLowerCase() === address.toLowerCase());
    if (idx < 0) return { rank: null as number | null, total: null as number | null, score: null as number | null };
    return { rank: idx + 1, total: list.length, score: list[idx]?.score ?? null };
  }, [leaderboard, address]);

  const liveRank = queryRank ?? lbLookup.rank;
  const liveTotal = queryTotal ?? lbLookup.total;
  const lbRecentSkillPct =
    lbLookup.score !== null && Number.isFinite(lbLookup.score)
      ? Math.round(lbLookup.score * 100)
      : null;

  const [copyOpen, setCopyOpen] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<{
    pool: string;
    marketId: string;
    side: BinarySide;
  } | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyHash, setCopyHash] = useState<string | null>(null);
  const copyOrder = useCopyOrder();
  const { address: followerAddress, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'fills' | 'edge'>('fills');
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [followOk, setFollowOk] = useState<string | null>(null);

  const followRulesQuery = useQuery({
    queryKey: [FOLLOW_RULES_QUERY_KEY, followerAddress],
    queryFn: () => fetchFollowRules(followerAddress!),
    enabled: isConnected && !!followerAddress,
    staleTime: 30_000,
    retry: 1,
  });

  const existingRule = useMemo(() => {
    const whale = (address ?? '').toLowerCase();
    return (followRulesQuery.data?.rules ?? []).find(
      (r) => r.whaleAddress.toLowerCase() === whale,
    ) ?? null;
  }, [followRulesQuery.data, address]);

  const canPersistFollow = isConnected && !!followerAddress && !followRulesQuery.isError;

  const handleAutoFollow = useCallback(async () => {
    if (!followerAddress || !address) return;
    setFollowBusy(true);
    setFollowError(null);
    setFollowOk(null);
    try {
      const rule: AutoCopyRule = existingRule
        ? { ...existingRule, status: 'ACTIVE' }
        : {
            whaleAddress: address,
            maxStake: 10,
            slippageCap: 1,
            status: 'ACTIVE',
            autoRoll: false,
            cashOutTarget: 150,
            stopLossRounds: 3,
            maxRounds: 20,
            dailyCap: 100,
          };
      await saveFollowRule(followerAddress, rule);
      await queryClient.invalidateQueries({ queryKey: [FOLLOW_RULES_QUERY_KEY, followerAddress] });
      setFollowOk('Follow rule saved. Manage it under Settings → Monitored Whales.');
    } catch (err) {
      setFollowError(err instanceof Error ? err.message : 'Failed to save follow rule');
    } finally {
      setFollowBusy(false);
    }
  }, [followerAddress, address, existingRule, queryClient]);

  const equityDataPoints = useMemo(
    () =>
      data
        ? buildEquityCurvePoints(selectSettledEquityMarkets(data.marketPnL), data.fills)
        : [],
    [data],
  );
  const equitySettlementCount = useMemo(
    () => countEquityCurveSettlements(equityDataPoints),
    [equityDataPoints],
  );

  const handleCopyClick = (pool: string, marketId: string, side: BinarySide) => {
    setSelectedMarket({ pool, marketId, side });
    setCopyOpen(true);
  };

  const handlePlaceOrder = async (params: {
    bankrollPct: number;
    maxNotionalUSD: number;
    slippageTolerance: number;
  }): Promise<string> => {
    if (!selectedMarket) throw new Error('No market selected');
    if (!data) throw new Error('Whale profile data unavailable');
    setCopyError(null);
    setCopyHash(null);
    try {
      const slippageBps = Math.max(0, Math.round(params.slippageTolerance * 10_000));
      const result = await copyOrder.mutateAsync({
        pool: selectedMarket.pool,
        marketId: selectedMarket.marketId,
        whaleAddress: data.address,
        whaleSide: selectedMarket.side,
        stakeHuman: params.maxNotionalUSD * params.bankrollPct,
        exposureCap: params.maxNotionalUSD,
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
  const rankDisplay = resolveRankDisplay(liveRank, liveTotal);
  const consistency = resolveConsistencyDisplay(s.consistencyFactor, s.variancePenalty);
  const isPositivePnL = s.totalRealizedPnL >= 0;
  const sortedFills = [...(data.fills ?? [])].sort(
    (a, b) => Number(b.timestamp) - Number(a.timestamp),
  );

  const firstCopyPosition = data.openPositions[0];

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
              <span className={`badge ${rankDisplay.status === 'ranked' ? 'badge-accent' : 'badge-outline'} font-mono text-xs`}>
                {rankDisplay.whaleLabel}
              </span>
            </h2>
            <div className="profile-address">{s.address}</div>
            <div className="profile-meta">
              {scorePct}% profile skill · {winRatePct}% Win Rate across {s.totalMarkets} settled markets
              {rankDisplay.percentileLabel ? (
                <span className="badge badge-outline text-xs ml-2">
                  {rankDisplay.percentileLabel}
                </span>
              ) : rankDisplay.status === 'ranked' && rankDisplay.rank !== null ? (
                <span className="badge badge-outline text-xs ml-2">
                  #{rankDisplay.rank}{rankDisplay.total ? ` / ${rankDisplay.total}` : ''}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="profile-actions">
          {canPersistFollow ? (
            <button
              type="button"
              onClick={() => void handleAutoFollow()}
              disabled={followBusy || (existingRule?.status === 'ACTIVE')}
              title={
                existingRule?.status === 'ACTIVE'
                  ? 'Already following — edit the rule in Settings'
                  : 'Save an Auto-Follow rule (durable store / KV; session key still required for worker copies)'
              }
              className={`btn disabled:opacity-40 disabled:cursor-not-allowed ${
                existingRule?.status === 'ACTIVE' ? 'btn-outline' : 'btn-accent'
              }`}
            >
              <Play className="w-4 h-4 mr-1" />
              {followBusy
                ? 'Saving…'
                : existingRule?.status === 'ACTIVE'
                  ? 'Following'
                  : existingRule
                    ? 'Resume Auto-Follow'
                    : 'Auto-Follow'}
            </button>
          ) : (
            <button
              disabled
              title={
                !isConnected
                  ? 'Connect your wallet to save an Auto-Follow rule'
                  : followRulesQuery.isError
                    ? 'Follow-rules API unavailable'
                    : 'Auto-Follow requires a connected wallet'
              }
              className="btn btn-outline disabled:opacity-50"
            >
              <Play className="w-4 h-4 mr-1" />
              Auto-Follow unavailable
            </button>
          )}

          <button
            onClick={() => {
              if (!firstCopyPosition) return;
              handleCopyClick(firstCopyPosition.pool, firstCopyPosition.marketId, firstCopyPosition.side);
            }}
            disabled={!firstCopyPosition}
            className={`btn disabled:opacity-40 disabled:cursor-not-allowed ${
              firstCopyPosition ? 'btn-accent' : 'btn-outline'
            }`}
            title={firstCopyPosition ? 'Copy first open position' : 'No open positions to copy'}
          >
            <Copy className="w-4 h-4 mr-1" />
            1-Click Copy
          </button>
        </div>
      </div>

      {followOk && (
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border-accent)] rounded-lg flex items-center gap-3 animate-in text-sm">
          <Check className="w-5 h-5 text-[var(--green)] shrink-0" />
          <span>{followOk}{' '}
            <Link href="/settings" className="text-[var(--accent)] underline">Open Settings</Link>
          </span>
        </div>
      )}
      {followError && (
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--red)]/40 rounded-lg text-sm text-[var(--red)] animate-in">
          {followError}
        </div>
      )}
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
            <span className={`stat-trend ${rankDisplay.percentileLabel ? 'up' : 'neutral'}`}>
              {rankDisplay.percentileLabel
                ?? (rankDisplay.status === 'ranked' && rankDisplay.rank !== null
                  ? `#${rankDisplay.rank}`
                  : 'Unranked')}
            </span>
          </div>
          <div className="score-bar mt-3">
            <div className="score-bar-fill" style={{ width: `${scorePct}%` }} />
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-3 font-mono">
            Profile skill uses deeper fill history
            {lbRecentSkillPct !== null ? (
              <> · LB recent-window {lbRecentSkillPct}%</>
            ) : null}
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
            <span className={`stat-trend ${consistency.trend}`}>{consistency.label}</span>
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-3 font-mono">
            {consistency.subtitle}
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
            {equitySettlementCount} Settlement{equitySettlementCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className="card-body mt-2">
          <EquityCurve data={equityDataPoints} height={220} chartId="whaleProfileCurve" />
        </div>
      </div>

      {/* Category Breakdown & Per-Market Table Grid */}
      <div className="card animate-in delay-3">
        <div className="card-header">
          <h3 className="card-title">Live Open Positions</h3>
          <p className="card-desc">Current outcome-token holdings from the wallet portfolio</p>
        </div>
        <div className="card-body p-0 mt-2 overflow-x-auto">
          {data.openPositions.length === 0 ? (
            <div className="text-sm text-[var(--text-muted)] py-8 text-center">
              No live open positions available for copying.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Type</th>
                  <th>Side</th>
                  <th className="right">Shares</th>
                  <th className="right">Mark</th>
                  <th className="right">Stake</th>
                  <th className="right">Unrealized PnL</th>
                  <th className="right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.openPositions.map((position) => (
                  <tr key={position.marketId}>
                    <td className="mono text-xs">{shortenAddress(position.marketAddress)}</td>
                    <td><span className="badge badge-outline">{position.marketType}</span></td>
                    <td><span className="badge badge-accent">{position.side}</span></td>
                    <td className="right mono">{formatSharesHuman(position.sharesHuman)}</td>
                    <td className="right mono">{formatOpenPositionMoney(position.currentValueHuman)}</td>
                    <td
                      className="right mono"
                      title={position.costBasisUnknown ? 'Cost basis unavailable (incomplete fill reconstruction)' : undefined}
                    >
                      {formatOpenPositionMoney(position.stakeHuman)}
                    </td>
                    <td className={`right mono font-semibold ${
                      position.unrealizedPnlHuman === null
                        ? ''
                        : position.unrealizedPnlHuman >= 0 ? 'green' : 'red'
                    }`}>
                      {position.unrealizedPnlHuman === null
                        ? '—'
                        : formatPnL(position.unrealizedPnlHuman)}
                    </td>
                    <td className="right">
                      <button
                        onClick={() => handleCopyClick(position.pool, position.marketId, position.side)}
                        className="btn btn-accent btn-sm"
                      >
                        Copy
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(showAnalyticsLoading || analyticsFailure) && (
            <div className="mt-6 border-t border-[var(--border)]">
              <AnalyticsBanner
                loading={showAnalyticsLoading}
                error={analyticsFailure}
                onRetry={retryAnalytics}
              />
            </div>
          )}
          {!showAnalyticsLoading && !analyticsFailure && data.calibrationByMarketType.size > 0 && (
            <div className="mt-6 border-t border-[var(--border)] pt-4">
              <h4 className="text-sm font-semibold mb-3">Calibration by market type</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[...data.calibrationByMarketType.entries()].map(([marketType, result]) => (
                  <div key={marketType} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-secondary)]">{marketType}</span>
                    <span className="font-mono">{Math.round(result.score * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

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
                  </tr>
                </thead>
                <tbody>
                  {[...data.marketPnL]
                    .sort((a, b) => b.tradeCount - a.tradeCount)
                    .slice(0, 5)
                    .map((m) => {
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
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* F8: Calibration Section */}
      <div className="card animate-in delay-5">
        <div className="card-header flex flex-row items-center justify-between">
          <div>
            <h3 className="card-title">Probability Calibration</h3>
            <p className="card-desc">
              How well {shortenAddress(s.address)}&apos;s implied confidence matches actual resolution rates
            </p>
          </div>
          <span className={`badge ${data.calibration ? data.calibration.score >= 0.7 ? 'badge-green' : data.calibration.score >= 0.4 ? 'badge-amber' : 'badge-red' : 'badge-outline'} font-mono text-xs`}>
            {showAnalyticsLoading
              ? 'Loading…'
              : analyticsFailure
                ? 'Unavailable'
                : data.calibration
                  ? `${Math.round(data.calibration.score * 100)}% Calibrated`
                  : 'No data'}
          </span>
        </div>
        <div className="card-body mt-4">
          <AnalyticsGate
            loading={showAnalyticsLoading}
            error={analyticsFailure}
            onRetry={retryAnalytics}
          >
          {data.calibration && data.calibration.buckets.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-end justify-between text-xs text-[var(--text-muted)] mb-2">
                <span>Implied Probability</span>
                <span>Actual Win Rate</span>
              </div>
              <div className="h-64 flex items-end gap-2">
                {data.calibration.buckets.map((bucket) => {
                  const midPct = Math.round(bucket.midpoint * 100);
                  const actualPct = Math.round(bucket.actualWinRate * 100);
                  const deviation = Math.abs(bucket.actualWinRate - bucket.midpoint);
                  const barColor = deviation < 0.1 ? 'var(--green)' : deviation < 0.2 ? 'var(--amber)' : 'var(--red)';
                  const barHeight = Math.max(10, (bucket.actualWinRate / 1) * 200);
                  return (
                    <div key={bucket.lowerBound} className="flex-1 flex flex-col items-center">
                      <div
                        className="w-full rounded-t transition-colors"
                        style={{
                          height: `${barHeight}px`,
                          backgroundColor: barColor,
                          opacity: 0.7,
                        }}
                        title={`${midPct}% implied → ${actualPct}% actual (${bucket.wins}/${bucket.total})`}
                      />
                      <span className="text-xs text-[var(--text-secondary)] mt-1">
                        {midPct}%
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="h-px bg-[var(--border)] my-2" />
              <div className="flex justify-center">
                <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-[var(--green)]" />
                    <span>Well-calibrated (deviation &lt; 10%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-[var(--amber)]" />
                    <span>Miscalibrated (deviation 10-20%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-[var(--red)]" />
                    <span>Poorly calibrated (deviation &gt; 20%)</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[var(--text-muted)] py-8 text-center">
              Insufficient data for calibration analysis.
            </div>
          )}
          </AnalyticsGate>
        </div>
      </div>

      {/* F7: Fills / Edge Analysis Tabs */}
      <div className="card animate-in delay-5">
        <div className="card-header flex flex-row items-center justify-between">
          <div>
            <h3 className="card-title">On-Chain Fills</h3>
            <p className="card-desc">Individual order execution history</p>
          </div>
          <div className="flex items-center gap-1 bg-[var(--bg-body)] rounded-lg p-1">
            <button
              onClick={() => setActiveTab('fills')}
              className={`px-3 py-1.5 text-xs font-medium rounded ${
                activeTab === 'fills' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Fills Table
            </button>
            <button
              onClick={() => setActiveTab('edge')}
              className={`px-3 py-1.5 text-xs font-medium rounded ${
                activeTab === 'edge' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Edge Analysis
            </button>
          </div>
        </div>

        <div className="card-body p-0 mt-4 overflow-x-auto">
          {activeTab === 'fills' ? (
            <>
            <AnalyticsBanner
              loading={showAnalyticsLoading}
              error={analyticsFailure}
              onRetry={retryAnalytics}
            />
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
                    <th className="right">Edge (F7)</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFills.slice(0, 15).map((f) => {
                    const edge = data.edges?.get(f.id);
                    const edgeBps = edge?.edgeBps ?? null;
                    const isEdgePositive = edgeBps !== null && edgeBps > 0;
                    const edgeClass = edgeBps !== null
                      ? (isEdgePositive ? 'red' : 'green')
                      : 'text-[var(--text-secondary)]';
                    const quoteDecimals = resolveFillQuoteDecimals(
                      f.market,
                      data.marketPnL,
                      {
                        ...data.quoteDecimalsByMarket,
                        ...Object.fromEntries(
                          data.openPositions.map((p) => [p.marketId.toLowerCase(), p.quoteDecimals]),
                        ),
                      },
                    );
                    return (
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
                          {formatFillQuantity(f.quantity, quoteDecimals)}
                        </td>
                        <td className="right mono font-semibold text-[var(--accent)]">
                          {formatFillPrice(f.fillPrice, quoteDecimals)}
                        </td>
                        <td className={`right mono font-semibold ${edgeClass}`}>
                          <div className="flex items-center justify-end gap-1.5">
                            <span>{formatEdge(edgeBps)}</span>
                            {edge?.unavailableReason && (
                              <span className="text-xs text-[var(--text-muted)]" title={edge.unavailableReason}>unavailable</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            </>
          ) : (
            <AnalyticsGate
              loading={showAnalyticsLoading}
              error={analyticsFailure}
              onRetry={retryAnalytics}
            >
              <EdgeAnalysisScatter edges={data.edges ? Array.from(data.edges.values()) : []} />
            </AnalyticsGate>
          )}
        </div>
      </div>

      {selectedMarket && (
        <CopyOrderModal
          open={copyOpen}
          onOpenChange={setCopyOpen}
          whaleAddress={data.address}
          marketId={selectedMarket.marketId}
          pool={selectedMarket.pool}
          onPlaceOrder={handlePlaceOrder}
        />
      )}
    </div>
  );
}
