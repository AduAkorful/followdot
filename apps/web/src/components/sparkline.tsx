'use client';

interface SparklineProps {
  data?: number[];
  trend?: 'up' | 'down';
  height?: number;
  width?: string | number;
  color?: string;
  id?: string;
}

export function Sparkline({
  data,
  trend = 'up',
  height = 32,
  width = '100%',
  color,
  id = 'sparkGrad',
}: SparklineProps) {
  if (!data || data.length < 2) {
    return <div className="h-8 text-xs text-[var(--text-muted)]">Unavailable</div>;
  }
  const points = data;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const hasRange = max !== min;
  const range = hasRange ? max - min : 1;

  const strokeColor = color || (trend === 'up' ? 'var(--accent)' : 'var(--red)');
  const svgWidth = 160;
  const svgHeight = height;

  const normalizedPoints = points.map((val, idx) => {
    const x = (idx / (points.length - 1)) * svgWidth;
    const y = hasRange
      ? svgHeight - 4 - ((val - min) / range) * (svgHeight - 8)
      : svgHeight - 4; // Flat line at the baseline when min === max (e.g. 0)
    return { x, y };
  });

  // Generate cubic bezier path
  let pathD = `M${normalizedPoints[0].x},${normalizedPoints[0].y}`;
  for (let i = 0; i < normalizedPoints.length - 1; i++) {
    const curr = normalizedPoints[i];
    const next = normalizedPoints[i + 1];
    const cpX = (curr.x + next.x) / 2;
    pathD += ` Q${cpX},${curr.y} ${next.x},${next.y}`;
  }

  const lastPoint = normalizedPoints[normalizedPoints.length - 1];
  const areaD = `${pathD} L${svgWidth},${svgHeight} L0,${svgHeight} Z`;
  const gradId = `sparkGrad_${id}_${trend}`;

  return (
    <div className="sparkline w-full overflow-hidden">
      <svg width={width} height={height} viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradId})`} />
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
        <circle cx={lastPoint.x} cy={lastPoint.y} r="3" fill={strokeColor} />
      </svg>
    </div>
  );
}
