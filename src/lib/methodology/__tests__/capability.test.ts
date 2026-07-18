import { describe, it, expect } from "vitest";
import { parseCapabilityPaste, UNASSIGNED } from "../capability";

describe("capability paste parser (add_Capability semantics)", () => {
  it("parses tab-separated L0/L1/L2 rows into a deduplicated tree", () => {
    const text = [
      "Ops\tFinance\tGeneral Ledger",
      "Ops\tFinance\tAccounts Payable",
      "Ops\tFinance\tGeneral Ledger", // duplicate row
      "Ops\tHR\tPayroll",
    ].join("\n");
    const { tree, rowCount } = parseCapabilityPaste(text);
    expect(rowCount).toBe(4);
    expect([...tree.keys()]).toEqual(["Ops"]);
    expect([...tree.get("Ops")!.keys()]).toEqual(["Finance", "HR"]);
    expect([...tree.get("Ops")!.get("Finance")!]).toEqual(["General Ledger", "Accounts Payable"]);
  });

  it("blank L0/L1 cells become Unassigned placeholders (workbook 'Level L0'/'Level L1')", () => {
    const { tree } = parseCapabilityPaste("\tFinance\tGL\n\t\tOrphan L2");
    expect(tree.get(UNASSIGNED)?.get("Finance")?.has("GL")).toBe(true);
    expect(tree.get(UNASSIGNED)?.get(UNASSIGNED)?.has("Orphan L2")).toBe(true);
  });

  it("same L1 name under different L0s keeps separate children", () => {
    const { tree } = parseCapabilityPaste("A\tShared\tX\nB\tShared\tY");
    expect([...tree.get("A")!.get("Shared")!]).toEqual(["X"]);
    expect([...tree.get("B")!.get("Shared")!]).toEqual(["Y"]);
  });

  it("rows without an L2 still register the L0/L1 pair; empty lines skipped", () => {
    const { tree, rowCount, skippedLines } = parseCapabilityPaste("Ops\tFinance\n\n \t \t \n");
    expect(rowCount).toBe(1);
    expect(skippedLines).toBe(1);
    expect(tree.get("Ops")?.get("Finance")?.size).toBe(0);
  });

  it("trims whitespace and tolerates CRLF", () => {
    const { tree } = parseCapabilityPaste("Ops \t Finance \t GL \r\n");
    expect(tree.get("Ops")?.get("Finance")?.has("GL")).toBe(true);
  });
});
