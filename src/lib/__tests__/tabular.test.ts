import { describe, it, expect } from "vitest";
import { escapeCsvCell, toCsv, parseTsvWithHeader, parseBooleanCell } from "../tabular";

describe("CSV export escaping", () => {
  it("neutralizes formula injection (=, +, -, @, tab, CR prefixes)", () => {
    expect(escapeCsvCell("=1+2")).toBe("'=1+2");
    expect(escapeCsvCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(escapeCsvCell("-2")).toBe("'-2");
    expect(escapeCsvCell("@cmd")).toBe("'@cmd");
  });

  it("quotes cells containing commas, quotes, or newlines", () => {
    expect(escapeCsvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("passes plain values through; null/undefined become empty", () => {
    expect(escapeCsvCell("Payroll Engine")).toBe("Payroll Engine");
    expect(escapeCsvCell(4.25)).toBe("4.25");
    expect(escapeCsvCell(null)).toBe("");
  });

  it("toCsv emits CRLF rows with a header", () => {
    const csv = toCsv(["a", "b"], [["x", 1]]);
    expect(csv).toBe("a,b\r\nx,1\r\n");
  });
});

describe("TSV paste import", () => {
  const aliases = {
    name: ["name", "applicationname", "application"],
    acronym: ["acronym"],
    inScope: ["inscope", "scope"],
  } as const;

  it("maps normalized header names through aliases", () => {
    const { records, unknownColumns } = parseTsvWithHeader("Application Name\tAcronym\tIn Scope?\nGL System\tGLS\tY", aliases);
    expect(records).toEqual([{ name: "GL System", acronym: "GLS", inScope: "Y" }]);
    expect(unknownColumns).toEqual([]);
  });

  it("ignores unknown columns but reports them", () => {
    const { records, unknownColumns } = parseTsvWithHeader("Name\tMystery\nApp\tX", aliases);
    expect(records).toEqual([{ name: "App" }]);
    expect(unknownColumns).toEqual(["mystery"]);
  });

  it("skips blank lines and empty cells", () => {
    const { records } = parseTsvWithHeader("Name\tAcronym\n\nApp One\t\nApp Two\tAT\n", aliases);
    expect(records).toEqual([{ name: "App One" }, { name: "App Two", acronym: "AT" }]);
  });

  it("parses lenient booleans", () => {
    expect(parseBooleanCell("Y", false)).toBe(true);
    expect(parseBooleanCell("no", true)).toBe(false);
    expect(parseBooleanCell(undefined, true)).toBe(true);
  });
});
