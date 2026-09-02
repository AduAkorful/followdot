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
        return <AlertTriangle className="w-4 h-4 text-[var(--amber)]" />;
      case "block":
        return <AlertCircle className="w-4 h-4 text-[var(--red)]" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copy {shortenAddress(whaleAddress)}</DialogTitle>
          <DialogDescription>
            Place a one-click copy order mirroring this whale position.
            Your wallet will sign and execute the order on DreamDEX.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* F6: Risk Check Section — only when market context is available */}
          {hasMarketContext && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Risk Check</Label>
                {riskLoading && <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />}
              </div>

              {riskError && (
                <div className="text-xs text-[var(--red)]">
                  Failed to load risk gates: {riskError instanceof Error ? riskError.message : String(riskError)}
                </div>
              )}

              {health && (
                <div className="space-y-2">
                  {health.gates.map((gate) => (
                    <div key={gate.id} className="flex items-start gap-3 text-sm">
                      <div className="mt-0.5 shrink-0">{getRiskIcon(gate.status)}</div>
                      <div className="flex-1">
                        <div className="font-medium">{gate.label}</div>
                        <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                          {gate.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {health && !canPlaceOrder && (
                <div className="p-3 bg-[var(--red)]/10 border border-[var(--red)]/30 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-[var(--red)] shrink-0 mt-0.5" />
                  <div className="text-xs text-[var(--red)]">
                    <span className="font-medium">Cannot proceed.</span>
                    {" "}
                    {blockedGates.map((g) => g.label).join(", ")} must clear before placing a copy order.
                  </div>
                </div>
              )}

              {health?.hasWarnings && canPlaceOrder && (
                <div className="p-3 bg-[var(--amber)]/10 border border-[var(--amber)]/30 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-[var(--amber)] shrink-0 mt-0.5" />
                  <div className="text-xs text-[var(--amber)]">
                    <span className="font-medium">Warnings present.</span>
                    {" "}
                    You can proceed, but review the amber gates above.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bankroll allocation */}
          <div>
            <Label className="text-sm">Bankroll allocation</Label>
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
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>1%</span>
              <span>{bankrollPct}% of bankroll</span>
              <span>100%</span>
            </div>
          </div>

          <div>
            <Label htmlFor="max-notional">Max notional per trade (USDC)</Label>
            <Input
              id="max-notional"
              type="number"
              value={maxNotional}
              onChange={(e) => setMaxNotional(Number(e.target.value))}
              min={1}
              max={10000}
              disabled={isPlacing}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Estimated copy amount: ${estimatedCopyAmount.toFixed(2)}
            </p>
          </div>

          <div>
            <Label htmlFor="slippage">Slippage tolerance (%)</Label>
            <Input
              id="slippage"
              type="number"
              value={slippage}
              onChange={(e) => setSlippage(Number(e.target.value))}
              min={0.1}
              max={5}
              step={0.1}
              disabled={isPlacing}
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Whale:</span>
            <code className="font-mono">{shortenAddress(whaleAddress)}</code>
            <Button variant="ghost" size="sm" onClick={handleCopyAddress}>
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
          <Button
            onClick={handlePlaceOrder}
            disabled={isPlacing || (hasMarketContext && !canPlaceOrder) || (hasMarketContext && riskLoading)}
          >
            {isPlacing ? "Placing…" : "Place copy order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
