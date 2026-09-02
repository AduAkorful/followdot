'use client';

import type { EdgeAtEntry } from "@/lib/whale-profile";

interface EdgeAnalysisScatterProps {
  edges: EdgeAtEntry[];
}

const MARGIN = { top: 20, right: 20, bottom: 40, left: 40 };
const WIDTH = 320;
const HEIGHT = 280;
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

export function EdgeAnalysisScatter({ edges }: EdgeAnalysisScatterProps) {
  if (edges.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--text-muted)]">
        No edge data available for this market type.
      </div>
    );
  }

  const pointsWithFair = edges.filter(
    (e): e is EdgeAtEntry & { fairValue: number; edgeBps: number } =>
      e.fairValue !== null && e.edgeBps !== null,
  );

  // Compute y-axis range from available data
  const allValues = pointsWithFair.flatMap((e) => [e.fillPrice, e.fairValue as number]);
  const yMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const yMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  const yPadding = (yMax - yMin) * 0.1 || 0.1;

  const yDomainMin = Math.max(0, yMin - yPadding);
  const yDomainMax = Math.min(1, yMax + yPadding);

  const sx = (v: number) => MARGIN.left + v * PLOT_W;
  const sy = (v: number) => {
    if (yDomainMax === yDomainMin) return MARGIN.top + PLOT_H / 2;
    return MARGIN.top + ((yDomainMax - v) / (yDomainMax - yDomainMin)) * PLOT_H;
  };

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-start gap-4 mb-3 text-xs flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-[var(--green)]" />
          <span>Good entry (negative edge)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-[var(--red)]" />
          <span>Bad entry (positive edge)</span>
        </div>
      </div>

      <svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="text-[var(--text-secondary)]">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={`gx-${v}`}>
            <line x1={sx(v)} y1={MARGIN.top} x2={sx(v)} y2={MARGIN.top + PLOT_H} stroke="var(--border)" strokeWidth={0.5} />
            <text x={sx(v)} y={MARGIN.top + PLOT_H + 14} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">{v.toFixed(2)}</text>
          </g>
        ))}
        {[yDomainMin, yDomainMax].map((v) => (
          <g key={`gy-${v}`}>
            <line x1={MARGIN.left} y1={sy(v)} x2={MARGIN.left + PLOT_W} y2={sy(v)} stroke="var(--border)" strokeWidth={0.5} />
            <text x={MARGIN.left - 8} y={sy(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-secondary)">{v.toFixed(2)}</text>
          </g>
        ))}

        {/* Diagonal reference line (fair == entry) */}
        <line
          x1={sx(yDomainMin)} y1={sy(yDomainMin)}
          x2={sx(yDomainMax)} y2={sy(yDomainMax)}
          stroke="var(--border)" strokeWidth={1} strokeDasharray="4 2"
        />
        <text x={sx(yDomainMax) - 4} y={sy(yDomainMax) - 4} fontSize={9} fill="var(--text-muted)" textAnchor="end">
          fair = entry
        </text>

        {/* Fair-value points, colored by edge sign */}
        {pointsWithFair.map((e) => {
          const edgeBps = e.edgeBps;
          const color = edgeBps >= 0 ? "var(--red)" : "var(--green)";
          const r = Math.max(3, Math.min(6, Math.abs(edgeBps) / 20));
          const fy = e.fairValue as number;
          return (
            <circle
              key={e.fillId}
              cx={sx(e.fillPrice)}
              cy={sy(fy)}
              r={r}
              fill={color}
              opacity={0.7}
            >
              <title>Fill: {e.fillPrice.toFixed(4)} → Fair: {fy.toFixed(4)} ({edgeBps > 0 ? "+" : ""}{edgeBps.toFixed(0)} bps)</title>
            </circle>
          );
        })}

        {/* Axes labels */}
        <text x={MARGIN.left + PLOT_W / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">Fill Price (YES prob)</text>
        <text x={10} y={MARGIN.top + PLOT_H / 2} textAnchor="middle" fontSize={11} fill="var(--text-secondary)" transform={`rotate(-90 10 ${MARGIN.top + PLOT_H / 2})`}>Fair Value (YES prob)</text>
      </svg>

      <div className="flex justify-between text-xs text-[var(--text-muted)] mt-2">
        <span>0</span>
        <span>1</span>
      </div>
    </div>
  );
}
