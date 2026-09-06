'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface AutoCopyRule {
  whaleAddress: string;
  maxStake: number;
  slippageCap: number;
  status: 'ACTIVE' | 'PAUSED';
  autoRoll: boolean;
  cashOutTarget: number;
  stopLossRounds: number;
  maxRounds: number;
  dailyCap: number;
}

interface EditRuleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: AutoCopyRule | null;
  onSaveRule: (updatedRule: AutoCopyRule) => void;
}

export function EditRuleModal({
  open,
  onOpenChange,
  rule,
  onSaveRule,
}: EditRuleModalProps) {
  if (!rule) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <EditRuleForm key={rule.whaleAddress} rule={rule} onSaveRule={onSaveRule} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EditRuleForm({
  rule,
  onSaveRule,
  onCancel,
}: {
  rule: AutoCopyRule;
  onSaveRule: (updatedRule: AutoCopyRule) => void;
  onCancel: () => void;
}) {
  const [maxStake, setMaxStake] = useState(rule.maxStake);
  const [slippageCap, setSlippageCap] = useState(rule.slippageCap);
  const [status, setStatus] = useState<'ACTIVE' | 'PAUSED'>(rule.status);
  const [autoRoll, setAutoRoll] = useState(rule.autoRoll);
  const [cashOutTarget, setCashOutTarget] = useState(rule.cashOutTarget);
  const [stopLossRounds, setStopLossRounds] = useState(rule.stopLossRounds);
  const [maxRounds, setMaxRounds] = useState(rule.maxRounds);
  const [dailyCap, setDailyCap] = useState(rule.dailyCap);

  const handleSave = () => {
    onSaveRule({
      ...rule,
      maxStake,
      slippageCap,
      status,
      autoRoll,
      cashOutTarget,
      stopLossRounds,
      maxRounds,
      dailyCap,
    });
    onCancel();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">Edit Auto-Copy Rule</DialogTitle>
        <DialogDescription className="text-[var(--text-secondary)] text-sm font-mono">
          Whale: {rule.whaleAddress.slice(0, 6)}…{rule.whaleAddress.slice(-4)}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-3">
        <div>
          <Label className="text-xs text-[var(--text-secondary)]">Max Stake Per Trade (USDC)</Label>
          <Input
            type="number"
            value={maxStake}
            onChange={(e) => setMaxStake(Number(e.target.value))}
            min={1}
            max={10000}
            className="mt-1 bg-[var(--bg-input)] border-[var(--border)]"
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="auto-roll" className="text-xs text-[var(--text-secondary)]">Auto-roll winning positions</Label>
          <input id="auto-roll" type="checkbox" checked={autoRoll} onChange={(e) => setAutoRoll(e.target.checked)} />
        </div>

        {autoRoll && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-[var(--text-secondary)]">Cash-out target (%)</Label>
              <Input type="number" min={100} value={cashOutTarget} onChange={(e) => setCashOutTarget(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs text-[var(--text-secondary)]">Stop-loss rounds</Label>
              <Input type="number" min={1} value={stopLossRounds} onChange={(e) => setStopLossRounds(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs text-[var(--text-secondary)]">Maximum rounds</Label>
              <Input type="number" min={1} value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs text-[var(--text-secondary)]">Daily cap (USDC)</Label>
              <Input type="number" min={0} value={dailyCap} onChange={(e) => setDailyCap(Number(e.target.value))} />
            </div>
          </div>
        )}

        <div>
          <Label className="text-xs text-[var(--text-secondary)]">Slippage Cap (%)</Label>
          <Input
            type="number"
            value={slippageCap}
            onChange={(e) => setSlippageCap(Number(e.target.value))}
            min={0.1}
            max={5.0}
            step={0.1}
            className="mt-1 bg-[var(--bg-input)] border-[var(--border)]"
          />
        </div>

        <div>
          <Label className="text-xs text-[var(--text-secondary)]">Rule Status</Label>
          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              onClick={() => setStatus('ACTIVE')}
              className={`btn btn-sm ${status === 'ACTIVE' ? 'btn-accent' : 'btn-ghost'}`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setStatus('PAUSED')}
              className={`btn btn-sm ${status === 'PAUSED' ? 'badge-red' : 'btn-ghost'}`}
            >
              Paused
            </button>
          </div>
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button
          variant="ghost"
          onClick={onCancel}
          className="text-[var(--text-secondary)]"
        >
          Cancel
        </Button>
        <Button onClick={handleSave} className="btn-accent">
          Save Changes
        </Button>
      </DialogFooter>
    </>
  );
}
