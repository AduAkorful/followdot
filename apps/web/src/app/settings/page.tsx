'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { ConnectButton } from '@/components/connect-button';
import { EditRuleModal, AutoCopyRule } from '@/components/edit-rule-modal';
import {
  NO_WHALES_FOLLOWED_YET,
  fetchFollowRules,
  saveFollowRule,
} from '@/lib/follow-rules';
import { Key, Shield, Pause, Play, Edit3 } from 'lucide-react';
import Link from 'next/link';
import {
  classifySessionKeyError,
  fetchSessionKeyStatus,
  grantDreamDexSessionKey,
  registerSessionKey,
  setSessionOperatorApproval,
} from '@/lib/grant-session-key';
import type { Address } from 'viem';

interface SessionStatus {
  active: boolean;
  sessionAddress: string | null;
  grantTxHash: string | null;
  onChainGranted: boolean;
  workerNote?: string;
}

export default function SettingsPage() {
  const { isConnected, address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [bankrollCap, setBankrollCap] = useState<number | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionKeyAddress, setSessionKeyAddress] = useState<string | null>(null);
  const [grantTxHash, setGrantTxHash] = useState<string | null>(null);
  const [onChainGranted, setOnChainGranted] = useState(false);
  const [workerNote, setWorkerNote] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [rules, setRules] = useState<AutoCopyRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [editingRule, setEditingRule] = useState<AutoCopyRule | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const [sessionGranting, setSessionGranting] = useState(false);
  const [sessionRevoking, setSessionRevoking] = useState(false);
  /** Prevents double-click / overlapping MetaMask grants (duplicate setOperatorApprovalGlobal). */
  const grantInFlightRef = useRef(false);

  const applyStatus = useCallback((data: SessionStatus) => {
    setSessionActive(Boolean(data.active && data.sessionAddress));
    setSessionKeyAddress(data.sessionAddress);
    setGrantTxHash(data.grantTxHash);
    setOnChainGranted(Boolean(data.onChainGranted));
    setWorkerNote(data.workerNote ?? null);
  }, []);

  const refreshSessionStatus = useCallback(async (opts?: { keepError?: boolean }) => {
    if (!address) return;
    try {
      const data = await fetchSessionKeyStatus(address);
      applyStatus({
        active: Boolean(data.active),
        sessionAddress: data.sessionAddress,
        grantTxHash: data.grantTxHash,
        onChainGranted: Boolean(data.onChainGranted),
        workerNote: data.workerNote,
      });
      // After a failed POST (chain grant ok, persist failed) keep the honest error —
      // do not wipe it just because GET returned inactive.
      if (!opts?.keepError) setSessionError(null);
    } catch (err) {
      setSessionError(classifySessionKeyError(err));
    }
  }, [address, applyStatus]);

  const refreshFollowRules = useCallback(async () => {
    if (!address) {
      setRules([]);
      return;
    }
    setRulesLoading(true);
    setRulesError(null);
    try {
      const data = await fetchFollowRules(address);
      setRules(data.rules ?? []);
    } catch (err) {
      setRulesError(err instanceof Error ? err.message : 'Failed to load follow rules');
      setRules([]);
    } finally {
      setRulesLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (isConnected && address) {
      void refreshSessionStatus();
      void refreshFollowRules();
    } else {
      setSessionActive(false);
      setSessionKeyAddress(null);
      setGrantTxHash(null);
      setOnChainGranted(false);
      setWorkerNote(null);
      setRules([]);
      setRulesError(null);
    }
  }, [isConnected, address, refreshSessionStatus, refreshFollowRules]);

  const handleGrantSessionKey = async () => {
    if (grantInFlightRef.current || sessionGranting) return;
    grantInFlightRef.current = true;
    setSessionGranting(true);
    setSessionError(null);

    let onChainSucceeded = false;
    let grantedAddress: string | null = null;
    let grantedTx: string | null = null;

    try {
      if (!address) throw new Error('Connect your wallet first.');
      if (!walletClient) throw new Error('Wallet client unavailable. Reconnect and try again.');

      // Already registered locally — do not mint another on-chain grant.
      if (sessionActive && sessionKeyAddress) {
        setSessionError('Session key already active. Revoke first to re-authorize.');
        return;
      }

      // 1) Ephemeral key + ONE MetaMask setOperatorApprovalGlobal (both selectors)
      const granted = await grantDreamDexSessionKey({ walletClient });
      onChainSucceeded = granted.onChainGranted;
      grantedAddress = granted.address;
      grantedTx = granted.grantTxHash;

      // 2) Persist — only mark Active after register succeeds
      const data = await registerSessionKey(address, {
        walletAddress: address,
        sessionAddress: granted.address,
        sessionKey: granted.privateKey,
        grantTxHash: granted.grantTxHash,
        onChainGranted: granted.onChainGranted,
      });

      applyStatus({
        active: true,
        sessionAddress: data.address ?? data.sessionAddress ?? granted.address,
        grantTxHash: data.grantTxHash ?? granted.grantTxHash,
        onChainGranted: data.onChainGranted ?? granted.onChainGranted,
        workerNote: data.workerNote,
      });
      setSessionError(null);
    } catch (err) {
      const classified = classifySessionKeyError(err);
      if (onChainSucceeded) {
        setSessionError(
          `${classified} On-chain approval landed` +
            (grantedTx ? ` (${grantedTx.slice(0, 10)}…)` : '') +
            (grantedAddress ? ` for ${grantedAddress.slice(0, 8)}…` : '') +
            ' but local registration did not complete — UI stays inactive. Retry Authorize only after checking MetaMask; avoid duplicate grants.',
        );
        // Explicitly stay inactive until register succeeds
        setSessionActive(false);
      } else {
        setSessionError(classified);
      }
      await refreshSessionStatus({ keepError: true });
    } finally {
      grantInFlightRef.current = false;
      setSessionGranting(false);
    }
  };

  const handleRevokeSessionKey = async () => {
    if (!address) return;
    setSessionRevoking(true);
    setSessionError(null);
    try {
      // Revoke on-chain first when we have a known session address + wallet client
      if (walletClient && sessionKeyAddress && onChainGranted) {
        try {
          await setSessionOperatorApproval({
            walletClient,
            operator: sessionKeyAddress as Address,
            approved: false,
          });
        } catch (err) {
          // Still clear local store, but surface chain revoke failure
          setSessionError(
            `On-chain revoke failed (${classifySessionKeyError(err)}). Clearing local registration anyway.`,
          );
        }
      }

      const res = await fetch('/api/auth-session-key', {
        method: 'DELETE',
        headers: { 'x-wallet-address': address },
      });
      if (res.status === 404) {
        throw new Error('Authorization endpoint not available (404)');
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Revoke failed (${res.status})`);
      }

      setSessionActive(false);
      setSessionKeyAddress(null);
      setGrantTxHash(null);
      setOnChainGranted(false);
      setWorkerNote(null);
    } catch (err) {
      setSessionError(classifySessionKeyError(err));
    } finally {
      setSessionRevoking(false);
    }
  };

  const handleToggleRuleStatus = async (whaleAddr: string) => {
    if (!address) return;
    const current = rules.find((r) => r.whaleAddress === whaleAddr);
    if (!current) return;
    const updated: AutoCopyRule = {
      ...current,
      status: current.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
    };
    setRulesSaving(true);
    setRulesError(null);
    try {
      const saved = await saveFollowRule(address, updated);
      setRules((prev) =>
        prev.map((r) => (r.whaleAddress.toLowerCase() === saved.whaleAddress.toLowerCase() ? saved : r)),
      );
    } catch (err) {
      setRulesError(err instanceof Error ? err.message : 'Failed to update rule');
    } finally {
      setRulesSaving(false);
    }
  };

  const handleSaveRule = async (updated: AutoCopyRule) => {
    if (!address) return;
    setRulesSaving(true);
    setRulesError(null);
    try {
      const saved = await saveFollowRule(address, updated);
      setRules((prev) =>
        prev.map((r) => (r.whaleAddress.toLowerCase() === saved.whaleAddress.toLowerCase() ? saved : r)),
      );
    } catch (err) {
      setRulesError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setRulesSaving(false);
    }
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
                  <div className="text-xs text-[var(--text-muted)]">On-chain Grant</div>
                  <div className="font-mono text-sm text-[var(--text-primary)] mt-1">
                    {onChainGranted
                      ? grantTxHash
                        ? `Confirmed · ${grantTxHash.slice(0, 10)}…`
                        : 'Granted (revocable, no expiry)'
                      : 'Local key only — on-chain grant missing'}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <div className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-[var(--green)]" />
                  Limited permissions: placeOrderFor + cancelOrderFor only. Cannot withdraw funds.
                </div>
                {workerNote && (
                  <p className="text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-lg p-3 bg-[var(--bg-body)]">
                    {workerNote}
                  </p>
                )}
                <div className="flex justify-end">
                  <button
                    onClick={handleRevokeSessionKey}
                    disabled={sessionRevoking}
                    className="btn btn-outline btn-sm !text-[var(--red)] !border-[var(--red)] disabled:opacity-40"
                  >
                    {sessionRevoking ? 'Revoking…' : 'Revoke Session Key'}
                  </button>
                </div>
              </div>
              {sessionError && <p className="text-xs text-[var(--red)]">{sessionError}</p>}
            </div>
          ) : (
            <div className="py-4 space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                Authorize an ephemeral session key so Followdot can automatically mirror whale trades in real-time when you are offline.
                MetaMask will prompt once to approve <span className="font-mono text-xs">placeOrderFor</span> /{' '}
                <span className="font-mono text-xs">cancelOrderFor</span> on the DreamDEX OperatorPermissionsRegistry.
              </p>
              <button
                onClick={() => void handleGrantSessionKey()}
                disabled={sessionGranting || !walletClient}
                className={`btn disabled:opacity-40 disabled:cursor-not-allowed ${sessionGranting ? 'btn-outline' : 'btn-accent'}`}
              >
                <Key className="w-4 h-4 mr-2" />
                {sessionGranting ? 'Authorizing… (check wallet)' : 'Authorize DreamDEX Session Key'}
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
          {rulesError && (
            <p className="px-4 py-2 text-xs text-[var(--red)]">{rulesError}</p>
          )}
          {rulesLoading ? (
            <div className="text-center py-16 text-[var(--text-muted)]">Loading saved follow rules…</div>
          ) : rules.length === 0 ? (
            <div className="text-center py-16 text-[var(--text-muted)]">
              {NO_WHALES_FOLLOWED_YET}. Use{' '}
              <span className="text-[var(--text-secondary)]">Auto-Follow</span> on a{' '}
              <Link href="/" className="text-[var(--accent)] underline">
                whale profile
              </Link>{' '}
              to save a rule here (durable across refresh when KV is configured). 1-Click Copy still works without Auto-Follow.
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
                          onClick={() => void handleToggleRuleStatus(rule.whaleAddress)}
                          disabled={rulesSaving}
                          className="btn btn-ghost btn-sm text-[var(--accent)] disabled:opacity-40"
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
