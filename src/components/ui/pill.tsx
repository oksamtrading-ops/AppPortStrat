import { cn } from "@/lib/utils";

export type PillColor = "green" | "red" | "amber" | "blue" | "gray" | "brand";

const STYLES: Record<PillColor, string> = {
  green: "border-green-600/40 bg-green-50 text-green-700",
  red: "border-red-600/40 bg-red-50 text-red-700",
  amber: "border-amber-600/40 bg-amber-50 text-amber-700",
  blue: "border-blue-600/40 bg-blue-50 text-blue-700",
  gray: "border-border bg-secondary text-muted-foreground",
  brand: "border-brand/50 bg-brand/10 text-foreground",
};

const DOTS: Record<PillColor, string> = {
  green: "bg-green-600",
  red: "bg-red-600",
  amber: "bg-amber-500",
  blue: "bg-blue-600",
  gray: "bg-muted-foreground/50",
  brand: "bg-brand",
};

/** Screenshot-style status pill: rounded outline chip with a colored dot. */
export function Pill({
  color,
  children,
  dot = true,
  className,
  title,
}: {
  color: PillColor;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        STYLES[color],
        className,
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOTS[color])} /> : null}
      {children}
    </span>
  );
}

/** Small numeric chip (counts), like the screenshot's "Caps"/"Integrations" columns. */
export function CountChip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="bg-secondary text-foreground inline-flex min-w-7 items-center justify-center rounded-full px-2 py-0.5 text-xs tabular-nums"
    >
      {children}
    </span>
  );
}
