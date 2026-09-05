'use client';

export interface EquityDataPoint {
  timestamp: number | string;
  pnl: number;
}

interface EquityCurveProps {
  data?: EquityDataPoint[];
  height?: number;
  chartId?: string;
}

export function EquityCurve({
  data = [],
  height = 200,
  chartId = 'eqGrad',
}: EquityCurveProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-[var(--text-muted)] text-center"
        style={{ height: `${height}px` }}
      >
        No settled PnL yet — equity curve appears after resolved markets.
      </div>
    );
  }

  const chartData = data;
  const pnlValues = chartData.map((d) => d.pnl);
  const minPnl = Math.min(0, ...pnlValues);
  const maxPnl = Math.max(0, ...pnlValues);
  const range = maxPnl - minPnl === 0 ? 1 : maxPnl - minPnl;

  const width = 800;
  const paddingLeft = 50;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const points = chartData.map((d, i) => {
    const x = paddingLeft + (i / Math.max(1, chartData.length - 1)) * chartWidth;
    const y = paddingTop + chartHeight - ((d.pnl - minPnl) / range) * chartHeight;
    return { x, y, pnl: d.pnl, timestamp: d.timestamp };
  });

  const zeroY = paddingTop + chartHeight - ((0 - minPnl) / range) * chartHeight;

  const pointsString = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `M${points[0].x},${zeroY} ` +
    points.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
    ` L${points[points.length - 1].x},${zeroY} Z`;

  const gradId = `equityGrad_${chartId}`;

  const formatPnlLabel = (val: number) => {
    if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}k`;
    return `$${val.toFixed(0)}`;
  };

  return (
    <div className="w-full overflow-hidden">
      <svg
        className="chart-area w-full"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ height: `${height}px` }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        <line x1={paddingLeft} y1={paddingTop} x2={width - paddingRight} y2={paddingTop} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        <line x1={paddingLeft} y1={paddingTop + chartHeight * 0.33} x2={width - paddingRight} y2={paddingTop + chartHeight * 0.33} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        <line x1={paddingLeft} y1={paddingTop + chartHeight * 0.66} x2={width - paddingRight} y2={paddingTop + chartHeight * 0.66} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />

        {/* Zero baseline */}
        <line
          x1={paddingLeft}
          y1={zeroY}
          x2={width - paddingRight}
          y2={zeroY}
          stroke="rgba(148,163,184,0.25)"
          strokeDasharray="4 4"
        />

        {/* Y-axis Labels */}
        <text x={paddingLeft - 8} y={paddingTop + 4} fill="var(--text-muted)" fontSize="10" textAnchor="end" fontFamily="var(--font-mono)">
          {formatPnlLabel(maxPnl)}
        </text>
        <text x={paddingLeft - 8} y={zeroY + 4} fill="var(--text-muted)" fontSize="10" textAnchor="end" fontFamily="var(--font-mono)">
          $0
        </text>
        {minPnl < 0 && (
          <text x={paddingLeft - 8} y={paddingTop + chartHeight + 4} fill="var(--text-muted)" fontSize="10" textAnchor="end" fontFamily="var(--font-mono)">
            {formatPnlLabel(minPnl)}
          </text>
        )}

        {/* Area fill */}
        <path d={areaPath} fill={`url(#${gradId})`} />

        {/* Line */}
        <polyline
          points={pointsString}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Highlight points */}
        {points.map((p, idx) => {
          if (idx === points.length - 1 || idx === Math.floor(points.length / 2) || idx === 0) {
            return (
              <circle
                key={idx}
                cx={p.x}
                cy={p.y}
                r="4"
                fill="var(--accent)"
                stroke="#0a0a0a"
                strokeWidth="2"
              />
            );
          }
          return null;
        })}
      </svg>
    </div>
  );
}
