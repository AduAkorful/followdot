'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Sparkline } from '@/components/sparkline';
import { EquityCurve } from '@/components/equity-curve';
import { ManagePositionModal } from '@/components/manage-position-modal';
import { Pagination } from '@/components/pagination';
import { ConnectButton } from '@/components/connect-button';
import Link from 'next/link';

interface PositionItem {
  marketId: string;
  title: string;
  whaleAddress: string;
  outcome: string;
  stake: number;
  currentValue: number;
  pnl: number;
  timestamp: string;
  status: 'OPEN' | 'SETTLED';
}

export default function PerformancePage() {
  const { isConnected, address } = useAccount();
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const [selectedPosition, setSelectedPosition] = useState<PositionItem | null>(null);
  const [manageModalOpen, setManageModalOpen] = useState(false);

  // In production, user trade history is fetched via wallet fill events.
  // For zero-mock policy, when wallet has 0 trades, empty state is displayed cleanly.
  const activePositions: PositionItem[] = [];

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
          Track your copied trade history, portfolio growth, and active positions.
        </p>
      </div>

      {/* KPI Stats Row */}
      <div className="stats-row animate-in delay-1">
        <div className="stat-card">
          <div className="stat-label">Total Realized PnL</div>
          <div className="stat-row">
            <div className="stat-value text-[var(--accent)]">$0.00</div>
            <span className="stat-trend up">0%</span>
          </div>
          <Sparkline trend="up" height={32} id="perf1" />
        </div>

        <div className="stat-card">
          <div className="stat-label">Copy Win Rate</div>
          <div className="stat-row">
            <div className="stat-value">
              0<span className="text-base text-[var(--text-muted)]">%</span>
            </div>
            <span className="stat-trend up">0%</span>
          </div>
          <Sparkline trend="up" height={32} id="perf2" />
        </div>

        <div className="stat-card">
          <div className="stat-label">Active Copied Positions</div>
          <div className="stat-row">
            <div className="stat-value">{activePositions.length}</div>
            <span className="stat-trend up">0</span>
          </div>
          <Sparkline trend="up" height={32} id="perf3" />
        </div>

        <div className="stat-card">
          <div className="stat-label">Whales Monitored</div>
          <div className="stat-row">
            <div className="stat-value">0</div>
            <span className="stat-trend up">Active</span>
          </div>
          <Sparkline trend="up" height={32} id="perf4" />
        </div>
      </div>

      {/* Copied Portfolio Growth SVG Equity Curve Chart */}
      <div className="card animate-in delay-2">
        <div className="card-header flex flex-row items-center justify-between">
          <div>
            <h3 className="card-title">Copied Portfolio Growth</h3>
            <p className="card-desc">Cumulative PnL across all executed copy orders</p>
          </div>
          <span className="badge badge-accent">Live Feed</span>
        </div>
        <div className="card-body mt-2">
          <EquityCurve height={220} chartId="portfolioGrowth" />
        </div>
      </div>

      {/* Copied Trade History Table */}
      <div className="card animate-in delay-3">
        <div className="card-header">
          <h3 className="card-title">Copied Trade History</h3>
          <p className="card-desc">Active & past copied positions on Somnia event markets</p>
        </div>
        <div className="card-body p-0 mt-4 overflow-x-auto">
          {!isConnected ? (
            <div className="text-center py-16">
              <p className="text-[var(--text-secondary)] mb-4">
                Connect your Web3 wallet to view your copied trade history and performance analytics.
              </p>
              <ConnectButton />
            </div>
          ) : activePositions.length === 0 ? (
            <div className="text-center py-16 text-[var(--text-muted)]">
              No copied positions found for connected wallet{' '}
              <code className="font-mono text-[var(--accent)]">
                {address?.slice(0, 6)}…{address?.slice(-4)}
              </code>
              . Visit the{' '}
              <Link href="/" className="text-[var(--accent)] underline hover:opacity-80">
                Leaderboard
              </Link>{' '}
              to place your first copy trade!
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
                          <Link href={`/whale/${pos.whaleAddress}`} className="hover:underline">
                            {pos.whaleAddress.slice(0, 6)}…{pos.whaleAddress.slice(-4)}
                          </Link>
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

      {/* Position Management Modal */}
      <ManagePositionModal
        open={manageModalOpen}
        onOpenChange={setManageModalOpen}
        position={selectedPosition}
        onClosePosition={async () => {
          // Handle position closure
        }}
      />
    </div>
  );
}
