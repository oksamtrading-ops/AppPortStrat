/**
 * CSV export + TSV paste-import utilities (pure).
 *
 * Export escapes CSV/Excel FORMULA INJECTION on every user-authored string:
 * cells starting with =, +, -, @ or tab/CR are prefixed with a single quote
 * so Excel treats them as text (Phase 3–5 security constraint).
 */

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>): string {
  const lines = [header.map(escapeCsvCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCsvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

/**
 * Parse a TSV paste (straight from Excel) with a header row. Header names are
 * normalized (lowercase, alphanumerics only) and mapped through `aliases`:
 * e.g. { name: ["name", "applicationname"], inScope: ["inscope", "scope"] }.
 * Returns one record per data row with the mapped keys; unknown columns are
 * ignored. Values are trimmed; empty → undefined.
 */
export function parseTsvWithHeader<K extends string>(
  text: string,
  aliases: Record<K, readonly string[]>,
): { records: Array<Partial<Record<K, string>>>; unknownColumns: string[]; rowCount: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { records: [], unknownColumns: [], rowCount: 0 };

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const headerCells = lines[0].split("\t").map((c) => normalize(c));

  const keyByColumn: Array<K | null> = headerCells.map((h) => {
    for (const key of Object.keys(aliases) as K[]) {
      if (aliases[key].includes(h)) return key;
    }
    return null;
  });
  const unknownColumns = headerCells.filter((_, i) => keyByColumn[i] === null);

  const records: Array<Partial<Record<K, string>>> = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const record: Partial<Record<K, string>> = {};
    cells.forEach((cell, i) => {
      const key = keyByColumn[i];
      const value = cell.trim();
      if (key && value !== "") record[key] = value;
    });
    if (Object.keys(record).length > 0) records.push(record);
  }
  return { records, unknownColumns, rowCount: records.length };
}

/** Lenient boolean parsing for pasted Y/N-style cells. */
export function parseBooleanCell(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["y", "yes", "true", "1", "x"].includes(value.trim().toLowerCase());
}
