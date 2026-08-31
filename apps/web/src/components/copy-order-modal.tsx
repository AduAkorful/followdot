'use client';

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Check } from "lucide-react";

interface CopyOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  whaleAddress: string;
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
  onPlaceOrder,
}: CopyOrderModalProps) {
  const [bankrollPct, setBankrollPct] = useState(10);
  const [maxNotional, setMaxNotional] = useState(100);
  const [slippage, setSlippage] = useState(0.5);
  const [isPlacing, setIsPlacing] = useState(false);
  const [copied, setCopied] = useState(false);

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
    if (isPlacing) return;
    setIsPlacing(true);
    try {
      await onPlaceOrder({
        bankrollPct: bankrollPct / 100,
        maxNotionalUSD: maxNotional * 100,
        slippageTolerance: slippage / 100,
      });
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to place copy order:", err);
    } finally {
      setIsPlacing(false);
    }
  };

  const estimatedCopyAmount = ((maxNotional * 100) * bankrollPct) / 100;

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
          >
            Cancel
          </Button>
          <Button onClick={handlePlaceOrder} disabled={isPlacing}>
            {isPlacing ? "Placing…" : "Place copy order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
