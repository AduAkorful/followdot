'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';

interface ManagePositionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position?: {
    marketId: string;
    title: string;
    outcome: string;
    stake: number;
    currentValue: number;
    pnl: number;
  } | null;
  onClosePosition?: (marketId: string) => Promise<void>;
}

export function ManagePositionModal({
  open,
  onOpenChange,
  position,
  onClosePosition,
}: ManagePositionModalProps) {
  const [isClosing, setIsClosing] = useState(false);

  if (!position) return null;

  const isPositive = position.pnl >= 0;
  const pnlSign = isPositive ? '+' : '';

  const handleClosePosition = async () => {
    if (isClosing) return;
    setIsClosing(true);
    try {
      if (onClosePosition) {
        await onClosePosition(position.marketId);
      }
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to close position:', err);
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-primary)]">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Manage Copied Position</DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)] text-sm">
            {position.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[var(--bg-body)] border border-[var(--border)]">
            <div>
              <div className="text-xs text-[var(--text-muted)]">Side & Stake</div>
              <div className="font-mono text-sm font-semibold mt-1">
                <span className="text-[var(--accent)]">{position.outcome}</span> · ${position.stake.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)]">Unrealized PnL</div>
              <div className={`font-mono text-sm font-semibold mt-1 ${isPositive ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                {pnlSign}${position.pnl.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg border border-[var(--border-accent)] bg-[var(--accent-glow)] text-xs text-[var(--text-secondary)] flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
            <span>
              Closing early will sell your outcome tokens back to the Somnia AMM at current market pricing.
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isClosing}
            className="text-[var(--text-secondary)]"
          >
            Cancel
          </Button>
          <Button
            onClick={handleClosePosition}
            disabled={isClosing}
            className="btn-accent"
          >
            {isClosing ? 'Closing Position...' : 'Close Position Early'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
