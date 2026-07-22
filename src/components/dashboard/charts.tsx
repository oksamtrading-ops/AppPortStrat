/**
 * Dependency-free, server-rendered charts (SVG donut + CSS bars) — no
 * client-side measurement or hydration, matching the matrix/heat-map
 * approach. Recharts was dropped: its ResponsiveContainer renders empty
 * when initial measurement fails.
 */

import Link from "next/link";

export interface Slice {
  name: string;
  value: number;
  color: string;
  /** Optional drill-through target — makes the slice's arc AND legend row a link. */
  href?: string;
}

export const CHART_COLORS = {
  green: "#16a34a",
  red: "#dc2626",
  amber: "#f59e0b",
  blue: "#2563eb",
  gray: "#9ca3af",
  brand: "#86BC25",
  dark: "#1f2937",
} as const;

export function DonutChart({
  slices,
  centerLabel,
  formatValue = (n) => String(n),
}: {
  slices: Slice[];
  centerLabel?: string;
  /** Formats each slice's value in the legend + tooltip (e.g. currency). Defaults to the raw number. */
  formatValue?: (value: number) => string;
}) {
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return <p className="text-muted-foreground py-10 text-center text-sm">No data yet</p>;
  }

  const R = 70;
  const STROKE = 26;
  const C = 2 * Math.PI * R;
  const offsets = data.map((_, i) => data.slice(0, i).reduce((sum, s) => sum + (s.value / total) * C, 0));
  const segments = data.map((s, i) => {
    const length = (s.value / total) * C;
    const visible = Math.max(length - 2, 0.5);
    return { ...s, dasharray: `${visible} ${C - visible}`, dashoffset: -offsets[i] };
  });

  return (
    <div className="space-y-3">
      <div className="relative mx-auto h-48 w-48">
        <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90">
          <circle cx="90" cy="90" r={R} fill="none" stroke="#f1f5f9" strokeWidth={STROKE} />
          {segments.map((s) => {
            const arc = (
              <circle
                cx="90"
                cy="90"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={STROKE}
                strokeDasharray={s.dasharray}
                strokeDashoffset={s.dashoffset}
              >
                <title>{`${s.name}: ${formatValue(s.value)}`}</title>
              </circle>
            );
            // SVG anchor (not next/link, which renders an HTML <a> invalid inside <svg>).
            return s.href ? (
              <a key={s.name} href={s.href} className="cursor-pointer">
                {arc}
              </a>
            ) : (
              <g key={s.name}>{arc}</g>
            );
          })}
        </svg>
        {centerLabel ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-xl font-semibold tabular-nums">{centerLabel}</span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        {data.map((s) => {
          const body = (
            <>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name} <span className="tabular-nums">({formatValue(s.value)})</span>
            </>
          );
          return s.href ? (
            <Link
              key={s.name}
              href={s.href}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs hover:underline"
            >
              {body}
            </Link>
          ) : (
            <span key={s.name} className="text-muted-foreground flex items-center gap-1 text-xs">
              {body}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function BucketBars({
  buckets,
  labels,
  color,
}: {
  buckets: number[];
  labels: readonly string[];
  color: string;
}) {
  const max = Math.max(1, ...buckets);
  return (
    <div className="flex h-44 items-end gap-3 pt-4">
      {buckets.map((value, i) => (
        <div key={labels[i]} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-muted-foreground text-xs tabular-nums">{value}</span>
          <div
            className="w-full rounded-t-md"
            style={{ backgroundColor: color, height: `${Math.round((value / max) * 120)}px`, minHeight: value > 0 ? 4 : 0 }}
            title={`${labels[i]}: ${value}`}
          />
          <span className="text-muted-foreground text-xs">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}
