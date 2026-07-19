import { describe, it, expect } from "vitest";
import { parseCapabilityImport } from "../capability";

describe("parseCapabilityImport (LeanIX-style exports)", () => {
  it("parses a Level 1/2/3 column CSV with quoted fields", () => {
    const csv = [
      "Level 1,Level 2,Level 3",
      "Finance,Accounting,General Ledger",
      'Finance,Accounting,"Payables, and Receivables"',
      "Finance,Treasury,",
    ].join("\n");
    const { tree, rowCount } = parseCapabilityImport(csv);
    expect(rowCount).toBe(3);
    expect([...tree.keys()]).toEqual(["Finance"]);
    expect([...tree.get("Finance")!.get("Accounting")!]).toEqual(["General Ledger", "Payables, and Receivables"]);
    expect(tree.get("Finance")!.has("Treasury")).toBe(true);
  });

  it("parses a Name + Parent adjacency export and skips levels deeper than three", () => {
    const csv = [
      "Name;Parent",
      "Finance;",
      "Accounting;Finance",
      "General Ledger;Accounting",
      "Journal Entry;General Ledger", // 4th level → skipped
    ].join("\n");
    const { tree, skippedLines } = parseCapabilityImport(csv);
    expect([...tree.get("Finance")!.get("Accounting")!]).toEqual(["General Ledger"]);
    expect(skippedLines).toBe(1);
  });

  it("treats a node with an unknown parent as a root", () => {
    const csv = ["Name,Parent", "Accounting,Finance"].join("\n");
    const { tree } = parseCapabilityImport(csv);
    expect(tree.has("Accounting")).toBe(true);
  });

  it("falls through to the classic headerless 3-column Excel paste", () => {
    const tsv = "Operations\tFinance\tGeneral Ledger\nOperations\tFinance\tAccounts Payable";
    const { tree, rowCount } = parseCapabilityImport(tsv);
    expect(rowCount).toBe(2);
    expect([...tree.get("Operations")!.get("Finance")!]).toEqual(["General Ledger", "Accounts Payable"]);
  });
});
