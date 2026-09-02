'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@/components/connect-button';
import { EditRuleModal, AutoCopyRule } from '@/components/edit-rule-modal';
import { Key, Shield, Pause, Play, Edit3 } from 'lucide-react';
import Link from 'next/link';

export default function SettingsPage() {
  const { isConnected } = useAccount();

  const [bankrollCap, setBankrollCap] = useState<number | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionKeyAddress, setSessionKeyAddress] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [rules, setRules] = useState<AutoCopyRule[]>([]);
  const [editingRule, setEditingRule] = useState<AutoCopyRule | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const handleGrantSessionKey = () => {
    setSessionError('Session-key delegation is unavailable until the configured worker authorization endpoint is live.');
  };

  const handleRevokeSessionKey = () => {
    setSessionActive(false);
    setSessionKeyAddress(null);
  };

  const handleToggleRuleStatus = (whaleAddr: string) => {
    setRules((prev) =>
      prev.map((r) =>
        r.whaleAddress === whaleAddr
          ? { ...r, status: r.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }
          : r
      )
    );
  };

  const handleSaveRule = (updated: AutoCopyRule) => {
    setRules((prev) =>
      prev.map((r) => (r.whaleAddress === updated.whaleAddress ? updated : r))
    );
  };

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h2 className="page-title">Auto-Copy Settings</h2>
        <p className="page-subtitle">
          Configure DreamDEX session keys for trustless, non-custodial auto-copying.
        </p>
      </div>

      {/* Session Key Delegation Card */}
      <div className="card animate-in delay-1">
        <div className="card-header flex flex-row items-center justify-between">
          <div>
            <h3 className="card-title flex items-center gap-2">
              <Key className="w-5 h-5 text-[var(--accent)]" />
              DreamDEX Session Key Status
            </h3>
            <p className="card-desc">
              Delegates limited trading permission to the Cloudflare Worker auto-copy bot
            </p>
          </div>
          <span className={`badge ${sessionActive ? 'badge-green' : 'badge-outline'}`}>
            {sessionActive ? 'Session Key Active' : 'No Active Session'}
          </span>
        </div>

        <div className="card-body mt-2 space-y-4">
          {!isConnected ? (
            <div className="py-8 text-center">
              <p className="text-[var(--text-secondary)] mb-4">
                Connect your wallet to configure auto-copy session keys.
              </p>
              <ConnectButton />
            </div>
          ) : sessionActive ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-[var(--bg-body)] border border-[var(--border)]">
                <div>
                  <div className="text-xs text-[var(--text-muted)]">Session Key Address</div>
                  <div className="font-mono text-sm text-[var(--accent)] mt-1">
                    {sessionKeyAddress?.slice(0, 10)}…{sessionKeyAddress?.slice(-8)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[var(--text-muted)]">Session Expiration</div>
                  <div className="font-mono text-sm text-[var(--text-primary)] mt-1">
                    {sessionError ?? 'Expiration unavailable'}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-[var(--green)]" />
                  Limited permissions: Can only place binary fills according to your rules. Cannot withdraw funds.
                </div>
                <button onClick={handleRevokeSessionKey} className="btn btn-outline btn-sm !text-[var(--red)] !border-[var(--red)]">
                  Revoke Session Key
                </button>
              </div>
            </div>
          ) : (
            <div className="py-4 space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                Authorize an ephemeral session key so Followdot can automatically mirror whale trades in real-time when you are offline.
              </p>
              <button onClick={handleGrantSessionKey} className="btn btn-accent">
                <Key className="w-4 h-4 mr-2" />
                Authorize DreamDEX Session Key
              </button>
              {sessionError && <p className="text-xs text-[var(--red)]">{sessionError}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Global Bankroll Safety Cap */}
      <div className="card animate-in delay-2">
        <div className="card-header">
          <h3 className="card-title">Global Bankroll Safety Cap</h3>
          <p className="card-desc">Maximum total notional USDC allocation for all auto-copied trades</p>
        </div>
        <div className="card-body mt-2">
          <div className="flex items-center gap-4 max-w-md">
            <input
              type="number"
              value={bankrollCap ?? ''}
              onChange={(e) => setBankrollCap(e.target.value === '' ? null : Number(e.target.value))}
              min={50}
              max={100000}
              step={50}
              className="search-box !w-full p-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] font-mono text-sm"
            />
            <span className="text-sm font-semibold text-[var(--accent)] font-mono">USDC</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-2">
            {bankrollCap === null
              ? 'Set a cap before enabling auto-copy.'
              : `Auto-copy bot will halt trading if total open copied exposure reaches $${bankrollCap.toFixed(2)} USDC.`}
          </p>
        </div>
      </div>

      {/* Monitored Whales & Auto-Copy Rules */}
      <div className="card animate-in delay-3">
        <div className="card-header flex flex-row items-center justify-between">
          <div>
            <h3 className="card-title">Monitored Whales & Auto-Copy Rules</h3>
            <p className="card-desc">Standing auto-mirror instructions per followed trader</p>
          </div>
          <Link href="/" className="btn btn-outline btn-sm">
            + Follow More Whales
          </Link>
        </div>

        <div className="card-body p-0 mt-4 overflow-x-auto">
          {rules.length === 0 ? (
            <div className="text-center py-16 text-[var(--text-muted)]">
              No active auto-copy rules configured. Visit the{' '}
              <Link href="/" className="text-[var(--accent)] underline">
                Leaderboard
              </Link>{' '}
              and click &quot;Auto-Follow&quot; on a whale profile to set up auto-mirroring.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Whale Address</th>
                  <th className="right">Max Stake (USDC)</th>
                  <th className="right">Slippage Cap</th>
                  <th className="right">Status</th>
                  <th className="right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.whaleAddress}>
                    <td className="mono font-medium">
                      <Link href={`/whale/${rule.whaleAddress}`} className="hover:underline">
                        {rule.whaleAddress.slice(0, 6)}…{rule.whaleAddress.slice(-4)}
                      </Link>
                    </td>
                    <td className="right mono">${rule.maxStake.toFixed(2)}</td>
                    <td className="right mono">{rule.slippageCap.toFixed(1)}%</td>
                    <td className="right">
                      <span className={`badge ${rule.status === 'ACTIVE' ? 'badge-green' : 'badge-red'}`}>
                        {rule.status}
                      </span>
                    </td>
                    <td className="right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditingRule(rule);
                            setEditModalOpen(true);
                          }}
                          className="btn btn-ghost btn-sm"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggleRuleStatus(rule.whaleAddress)}
                          className="btn btn-ghost btn-sm text-[var(--accent)]"
                        >
                          {rule.status === 'ACTIVE' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Edit Rule Modal */}
      <EditRuleModal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        rule={editingRule}
        onSaveRule={handleSaveRule}
      />
    </div>
  );
}
