'use client';

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRiskCheck } from "@/hooks/use-copy-order";
import { Copy, Check, AlertTriangle, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import type { RiskGate } from "@/lib/dreamdex";

interface CopyOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  whaleAddress: string;
  marketId?: string;
  pool?: string;
  onPlaceOrder: (params: {
    bankrollPct: number;
    maxNotionalUSD: number;
    slippageTolerance: number;
  }) => Promise<string>;
}

export function CopyOrderModal({
  open,
  onOpenChange,
  whaleAddress,
  marketId,
  pool,
  onPlaceOrder,
}: CopyOrderModalProps) {
  const [bankrollPct, setBankrollPct] = useState(10);
  const [maxNotional, setMaxNotional] = useState(100);
  const [slippage, setSlippage] = useState(0.5);
  const [isPlacing, setIsPlacing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Keep user-facing allocation in human USDC units; the hook converts to raw units
  // only after reading authoritative market decimals.
  const stakeHuman = Math.max(0, (maxNotional * bankrollPct) / 100);

  // F6: Risk check — re-evaluates when stake, market, or window changes
  const hasMarketContext = Boolean(marketId && pool);
  const { data: health, isFetching: riskLoading, error: riskError } = useRiskCheck({
    marketId,
    pool,
    whaleAddress,
    stakeHuman,
    exposureCap: maxNotional,
  });

  const canPlaceOrder = hasMarketContext && (health?.canProceed ?? false);
  const blockedGates = (health?.gates ?? []).filter((g) => g.status === "block");
  const placeBlocked =
    isPlacing ||
    (hasMarketContext && !canPlaceOrder) ||
    (hasMarketContext && riskLoading);
  const showBlockedOutline = hasMarketContext && !canPlaceOrder && !isPlacing && !riskLoading;

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(whaleAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy address:", err);
    }
  };

  const handlePlaceOrder = async () => {
    if (isPlacing || !canPlaceOrder) return;
    setIsPlacing(true);
    try {
      await onPlaceOrder({
        bankrollPct: bankrollPct / 100,
        maxNotionalUSD: maxNotional,
        slippageTolerance: slippage / 100,
      });
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to place copy order:", err);
    } finally {
      setIsPlacing(false);
    }
  };

  const estimatedCopyAmount = stakeHuman;

  const getRiskIcon = (status: RiskGate["status"]) => {
    switch (status) {
      case "pass":
        return <CheckCircle className="w-4 h-4 text-[var(--green)]" />;
      case "warn":
        return <AlertTriangle className="w-4 h-4 text-[var(--amber,#F59E0B)]" />;
      case "block":
        return <AlertCircle className="w-4 h-4 text-[var(--red)]" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            1-Click Copy · {shortenAddress(whaleAddress)}
          </DialogTitle>
          <DialogDescription>
            Mirror this whale on DreamDEX. Your wallet signs and executes the order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Stake summary */}
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-body)] p-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  Estimated stake
                </div>
                <div className="mt-1 font-mono text-xl font-bold text-[var(--accent)]">
                  ${estimatedCopyAmount.toFixed(2)}
                </div>
              </div>
              <div className="text-right text-xs text-[var(--text-secondary)]">
                <div>{bankrollPct}% of bankroll</div>
                <div className="font-mono">cap ${maxNotional.toFixed(0)} · {slippage}% slip</div>
              </div>
            </div>
          </div>

          {/* F6: Risk Check Section — only when market context is available */}
          {hasMarketContext && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-[var(--text-primary)]">Risk gates</Label>
                {riskLoading && <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />}
              </div>

              {riskError && (
                <div className="rounded-[var(--radius-md)] border border-[var(--red)]/30 bg-[var(--red)]/10 p-3 text-xs text-[var(--red)]">
                  Failed to load risk gates: {riskError instanceof Error ? riskError.message : String(riskError)}
                </div>
              )}

              {health && (
                <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-body)]">
                  {health.gates.map((gate, idx) => (
                    <div
                      key={gate.id}
                      className={`flex items-start gap-3 px-3 py-2.5 text-sm ${
                        idx > 0 ? "border-t border-[var(--border)]" : ""
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">{getRiskIcon(gate.status)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[var(--text-primary)]">{gate.label}</div>
                        <div className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                          {gate.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {health && !canPlaceOrder && (
                <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--red)]/30 bg-[var(--red)]/10 p-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--red)]" />
                  <div className="text-xs text-[var(--red)]">
                    <span className="font-medium">Cannot proceed.</span>
                    {" "}
                    {blockedGates.map((g) => g.label).join(", ")} must clear before placing a copy order.
                  </div>
                </div>
              )}

              {health?.hasWarnings && canPlaceOrder && (
                <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--amber,#F59E0B)]/30 bg-[var(--amber,#F59E0B)]/10 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amber,#F59E0B)]" />
                  <div className="text-xs text-[var(--amber,#F59E0B)]">
                    <span className="font-medium">Warnings present.</span>
                    {" "}
                    You can proceed, but review the amber gates above.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Allocation controls */}
          <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-body)] p-3">
            <div>
              <Label className="text-sm text-[var(--text-primary)]">Bankroll allocation</Label>
              <Slider
                value={[bankrollPct]}
                onValueChange={(v: number | readonly number[]) =>
                  setBankrollPct(Array.isArray(v) ? v[0] : v)
                }
                max={100}
                min={1}
                step={1}
                disabled={isPlacing}
              />
              <div className="mt-1 flex justify-between text-xs text-[var(--text-muted)]">
                <span>1%</span>
                <span className="text-[var(--text-secondary)]">{bankrollPct}% of bankroll</span>
                <span>100%</span>
              </div>
            </div>

            <div>
              <Label htmlFor="max-notional" className="text-sm text-[var(--text-primary)]">
                Max notional per trade (USDC)
              </Label>
              <Input
                id="max-notional"
                type="number"
                value={maxNotional}
                onChange={(e) => setMaxNotional(Number(e.target.value))}
                min={1}
                max={10000}
                disabled={isPlacing}
                className="mt-1 bg-[var(--bg-input)] border-[var(--border)] text-[var(--text-primary)]"
              />
            </div>

            <div>
              <Label htmlFor="slippage" className="text-sm text-[var(--text-primary)]">
                Slippage tolerance (%)
              </Label>
              <Input
                id="slippage"
                type="number"
                value={slippage}
                onChange={(e) => setSlippage(Number(e.target.value))}
                min={0.1}
                max={5}
                step={0.1}
                disabled={isPlacing}
                className="mt-1 bg-[var(--bg-input)] border-[var(--border)] text-[var(--text-primary)]"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>Whale</span>
            <code className="font-mono text-[var(--text-secondary)]">{shortenAddress(whaleAddress)}</code>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyAddress}
              className="h-7 px-2 text-[var(--text-secondary)]"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPlacing}
            className="text-[var(--text-secondary)]"
          >
            Cancel
          </Button>
          {showBlockedOutline ? (
            <Button
              type="button"
              variant="outline"
              disabled
              title="Risk gates must clear before placing a copy order"
              className="border-[var(--border)] text-[var(--text-secondary)] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Blocked by risk gates
            </Button>
          ) : (
            <Button
              onClick={handlePlaceOrder}
              disabled={placeBlocked}
              className="btn-accent disabled:opacity-60"
            >
              {isPlacing ? "Placing…" : riskLoading ? "Checking risk…" : "Place copy order"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
