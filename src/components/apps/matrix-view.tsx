import { DISPOSITION_LABELS, formatScore } from "@/lib/methodology";
import type { Disposition } from "@/lib/methodology";
import { cn } from "@/lib/utils";

export interface MatrixApp {
  id: string;
  name: string;
  acronym: string | null;
  bv: number;
  it: number;
  disposition: Disposition;
  /** Optional click-through target (spec §4.10: click → the application). */
  href?: string;
}

const DOT: Record<Disposition, string> = {
  KEEP_AS_IS: "bg-green-600",
  RETOOL: "bg-blue-600",
  REDESIGN: "bg-amber-500",
  TERMINATE: "bg-red-600",
  UNKNOWN: "bg-muted-foreground/40",
};

/**
 * The workbook's 4R Framework chart (inventory §8): X = Business Score,
 * Y = IT Score, threshold cross-hairs at the Optimum values. Pure CSS —
 * no chart library. Unscored apps (score 0 → Unknown) are listed, not plotted.
 */
export function MatrixView({
  apps,
  optBv,
  optIt,
}: {
  apps: MatrixApp[];
  optBv: number;
  optIt: number;
}) {
  const plotted = apps.filter((a) => a.disposition !== "UNKNOWN");
  const unscored = apps.length - plotted.length;
  const xPct = (bv: number) => `${(bv / 5) * 100}%`;
  const yPct = (it: number) => `${(1 - it / 5) * 100}%`;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-6">
        <div className="relative mx-auto aspect-square max-w-2xl">
          {/* Quadrant labels */}
          <span className="text-muted-foreground absolute left-2 top-2 text-xs font-medium">Re-Design</span>
          <span className="text-muted-foreground absolute right-2 top-2 text-xs font-medium">Keep-As-Is</span>
          <span className="text-muted-foreground absolute bottom-8 left-2 text-xs font-medium">Terminate</span>
          <span className="text-muted-foreground absolute bottom-8 right-2 text-xs font-medium">Re-Tool</span>

          {/* Frame */}
          <div className="absolute inset-0 rounded-md border" />

          {/* Threshold cross-hairs (Optimum BV vertical, Optimum IT horizontal) */}
          <div className="border-brand/70 absolute inset-y-0 border-l border-dashed" style={{ left: xPct(optBv) }} />
          <div className="border-brand/70 absolute inset-x-0 border-t border-dashed" style={{ top: yPct(optIt) }} />

          {plotted.map((a) => {
            const title = `${a.name} — BV ${formatScore(a.bv)}, IT ${formatScore(a.it)} → ${DISPOSITION_LABELS[a.disposition]}`;
            const className = cn(
              "absolute z-10 block h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white",
              a.href ? "hover:scale-125" : "cursor-default",
              DOT[a.disposition],
            );
            const style = { left: xPct(a.bv), top: yPct(a.it) };
            return a.href ? (
              <a key={a.id} href={a.href} title={title} className={className} style={style} />
            ) : (
              <span key={a.id} title={title} className={className} style={style} />
            );
          })}

          {/* Axis labels */}
          <span className="text-muted-foreground absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full text-xs">
            Business Score →
          </span>
          <span className="text-muted-foreground absolute -left-1 top-1/2 -translate-x-full -translate-y-1/2 -rotate-90 text-xs">
            IT Score →
          </span>
        </div>
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
        {(Object.keys(DOT) as Disposition[])
          .filter((d) => d !== "UNKNOWN")
          .map((d) => (
            <span key={d} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", DOT[d])} /> {DISPOSITION_LABELS[d]}
            </span>
          ))}
        {unscored > 0 ? <span>{unscored} unscored application(s) not plotted</span> : null}
      </div>
    </div>
  );
}
