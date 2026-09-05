'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useClaimablePositions, useClaimWinnings } from '@/hooks/use-claim-winnings';
import { ConnectButton } from '@/components/connect-button';
import { formatClaimAmount, scaleClaimAmount } from '@/lib/format-fill';
import { Loader2, AlertCircle, Check, Trophy } from 'lucide-react';

export default function ClaimPage() {
  const { isConnected } = useAccount();
  const { data: positions = [], isLoading, isError, error, refetch } = useClaimablePositions();
  const { mutateAsync: claim, isPending: isClaiming } = useClaimWinnings();
  const [claimedHash, setClaimedHash] = useState<string | null>(null);
  const [claimingIndex, setClaimingIndex] = useState<number | null>(null);

  const totalClaimableCount = positions.length;
  const claimAllDisabled = isClaiming || totalClaimableCount === 0;

  const totalEstPayout = positions.reduce<number | null>((acc, p) => {
    const scaled = scaleClaimAmount(p.estPayout, p.quoteDecimals);
    if (scaled === null) return acc;
    return (acc ?? 0) + scaled;
  }, null);

  const handleClaimAll = async () => {
    try {
      const result = await claim({ entries: positions });
      setClaimedHash(result.hash);
      refetch();
    } catch (err) {
      console.error('Claim all failed:', err);
    }
  };

  const handleClaimSingle = async (index: number) => {
    setClaimingIndex(index);
    try {
      const result = await claim({ entries: [positions[index]] });
      setClaimedHash(result.hash);
      refetch();
    } catch (err) {
      console.error('Single claim failed:', err);
    } finally {
      setClaimingIndex(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h2 className="page-title">Claim Winnings</h2>
        <p className="page-subtitle">
          Redeem outcome tokens from settled DreamDEX event contracts for USDC payouts.
        </p>
      </div>

      {/* Claim Hero Banner */}
      <div className="claim-hero animate-in delay-1">
        <div className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-semibold mb-2">
          Total Unclaimed Payout
        </div>
        <div className="claim-amount">
          {totalEstPayout === null
            ? (totalClaimableCount > 0 ? '—' : '$0.00')
            : `$${totalEstPayout.toFixed(2)}`}
        </div>
        <p className="claim-subtitle">
          {!isConnected
            ? 'Connect your wallet to check claimable winnings.'
            : isError
              ? 'Unable to load claimable positions right now.'
              : isLoading
                ? 'Checking settled markets for claimable positions…'
                : totalClaimableCount > 0
                  ? `You have ${totalClaimableCount} settled market positions ready for redemption.`
                  : 'No claimable positions for this wallet.'}
        </p>

        {isConnected ? (
          <button
            onClick={handleClaimAll}
            disabled={claimAllDisabled}
            className={`btn mx-auto disabled:opacity-40 disabled:cursor-not-allowed ${
              claimAllDisabled ? 'btn-outline' : 'btn-accent-lg'
            }`}
          >
            {isClaiming ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Claiming Winnings…
              </>
            ) : (
              <>
                <Trophy className="w-5 h-5 mr-2" />
                Claim All Winnings ({totalClaimableCount})
              </>
            )}
          </button>
        ) : (
          <div className="flex justify-center">
            <ConnectButton />
          </div>
        )}
      </div>

      {claimedHash && (
        <div className="p-4 bg-[var(--bg-card)] border border-[var(--border-accent)] rounded-lg flex items-center gap-3 animate-in">
          <Check className="w-5 h-5 text-[var(--green)] shrink-0" />
          <div className="text-sm">
            <span className="font-semibold text-[var(--green)]">Claim transaction confirmed!</span>{' '}
            Transaction hash:{' '}
            <code className="font-mono text-xs text-[var(--accent)]">
              {claimedHash.slice(0, 14)}…{claimedHash.slice(-8)}
            </code>
          </div>
        </div>
      )}

      {/* Claimable Positions Grid */}
      <div className="space-y-4 animate-in delay-2">
        <div className="flex items-center justify-between">
          <h3 className="card-title">Claimable Market Positions</h3>
          <span className="badge badge-accent">{totalClaimableCount} Available</span>
        </div>

        {!isConnected ? (
          <div className="card text-center py-16 text-[var(--text-muted)]">
            Connect your wallet to inspect claimable positions.
          </div>
        ) : isLoading ? (
          <div className="card flex items-center justify-center py-16 text-[var(--text-muted)]">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Querying settled event contracts…
          </div>
        ) : isError ? (
          <div className="card flex items-center justify-center py-12 text-[var(--red)]">
            <AlertCircle className="w-5 h-5 mr-2" />
            {error?.message}
          </div>
        ) : positions.length === 0 ? (
          <div className="card text-center py-16 text-[var(--text-muted)]">
            No claimable positions returned by getClaimable for this wallet.
          </div>
        ) : (
          <div className="grid-2">
            {positions.map((pos, idx) => {
              const singleDisabled = isClaiming || claimingIndex === idx;
              return (
              <div key={`${pos.marketId}-${pos.outcomeIdx}`} className="position-card">
                <div className="pos-header">
                  <div>
                    <div className="pos-title">
                      Market #{pos.marketId.slice(0, 8)}…{pos.marketId.slice(-6)}
                    </div>
                    <div className="pos-desc">
                      Pool: {pos.pool.slice(0, 10)}…{pos.pool.slice(-6)}
                    </div>
                  </div>
                  <span className="badge badge-green">
                    Outcome: {pos.outcomeIdx === 0 ? 'YES' : 'NO'}
                  </span>
                </div>

                <div className="my-3">
                  <div className="text-xs text-[var(--text-muted)]">Estimated Payout</div>
                  <div className="pos-amount">{formatClaimAmount(pos.estPayout, pos.quoteDecimals)} USDC</div>
                </div>

                <div className="pos-footer items-center pt-2 border-t border-[var(--border)]">
                  <span>{formatClaimAmount(pos.amount, pos.quoteDecimals)} outcome tokens</span>
                  <button
                    onClick={() => handleClaimSingle(idx)}
                    disabled={singleDisabled}
                    className={`btn btn-sm disabled:opacity-40 disabled:cursor-not-allowed ${
                      singleDisabled ? 'btn-outline' : 'btn-accent'
                    }`}
                  >
                    {claimingIndex === idx ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      'Claim Winnings'
                    )}
                  </button>
                </div>
              </div>
            );})}
          </div>
        )}
      </div>

      {/* Paginated Claims History Table */}
      <div className="card animate-in delay-3">
        <div className="card-header">
          <h3 className="card-title">Redemption History</h3>
          <p className="card-desc">Past claimed payouts from settled event contracts</p>
        </div>
        <div className="card-body p-0 mt-4 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Outcome</th>
                <th className="right">Tokens Redeemed</th>
                <th className="right">USDC Payout</th>
                <th className="right">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5} className="text-center py-12 text-[var(--text-muted)]">
                  No previous claim history found for this address.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
