/**
 * Finance survey sections that roll up into the Grand Total (workbook
 * Finance!D38 = sum of the four sub-totals; quirk #1 fixed — subtotals are
 * always computed). Past/Future/Budget/Revenue stay context-only.
 */
export const GRAND_TOTAL_SECTIONS: ReadonlySet<string> = new Set([
  "Hardware / Infrastructure Costs",
  "Application Maintenance Costs",
  "Application Development Costs",
  "Commercial Software Costs",
]);

export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}
