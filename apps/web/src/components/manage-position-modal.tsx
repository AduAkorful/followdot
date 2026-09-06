'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';
import { formatOpenPositionMoney } from '@/lib/open-position-display';

interface ManagePositionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position?: {
    marketId: string;
    title: string;
    outcome: string;
    stake: number | null;
    currentValue: number;
    pnl: number | null;
  } | null;
  /**
   * Live sell/close handler. When omitted, Close is disabled with honest
   * "Close coming soon" copy — never a button that pretends to close.
   */
  onClosePosition?: (marketId: string) => Promise<void>;
}

export function ManagePositionModal({
  open,
  onOpenChange,
  position,
  onClosePosition,
}: ManagePositionModalProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  if (!position) return null;

  const isPositive = position.pnl !== null && position.pnl >= 0;
  const closeAvailable = typeof onClosePosition === 'function';

  const handleClosePosition = async () => {
    if (!closeAvailable || isClosing || !onClosePosition) return;
    setIsClosing(true);
    setCloseError(null);
    try {
      await onClosePosition(position.marketId);
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to close position:', err);
      setCloseError(err instanceof Error ? err.message : 'Close failed');
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
                <span className="text-[var(--accent)]">{position.outcome}</span> · {formatOpenPositionMoney(position.stake)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)]">Unrealized PnL</div>
              <div className={`font-mono text-sm font-semibold mt-1 ${
                position.pnl === null
                  ? 'text-[var(--text-secondary)]'
                  : isPositive ? 'text-[var(--green)]' : 'text-[var(--red)]'
              }`}>
                {formatOpenPositionMoney(position.pnl, { signed: true })}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg border border-[var(--border-accent)] bg-[var(--accent-glow)] text-xs text-[var(--text-secondary)] flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
            <span>
              {closeAvailable
                ? 'Closing early will sell your outcome tokens back to the Somnia AMM at current market pricing.'
                : 'Early close (live sell via DreamDEX) is not wired yet. Hold to resolution or use Claim when settled.'}
            </span>
          </div>

          {closeError ? (
            <p className="text-xs text-[var(--red)] font-mono">{closeError}</p>
          ) : null}
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
          {closeAvailable ? (
            <Button
              onClick={handleClosePosition}
              disabled={isClosing}
              className="btn-accent"
            >
              {isClosing ? 'Closing Position...' : 'Close Position Early'}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled
              title="Early close is not wired to a live sell API yet"
              className="disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Close coming soon
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
