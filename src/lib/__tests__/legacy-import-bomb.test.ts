import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseLegacyWorkbook } from "../legacy-import";

/**
 * Security review: the legacy importer must refuse a decompression bomb —
 * a small compressed ZIP whose entries declare a huge uncompressed size —
 * before inflating anything.
 */
describe("legacy import — decompression-bomb guard", () => {
  it("rejects an archive whose declared uncompressed total exceeds the budget", async () => {
    // 400 MB of a single repeated byte compresses to a few KB but declares a
    // huge uncompressed size in the central directory.
    const huge = "A".repeat(400 * 1024 * 1024);
    const zip = new JSZip();
    zip.file("xl/workbook.xml", "<workbook/>");
    zip.file("xl/_rels/workbook.xml.rels", "<Relationships/>");
    zip.file("xl/sharedStrings.xml", huge);
    const buffer = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });

    await expect(parseLegacyWorkbook(buffer, [])).rejects.toThrow(/decompress/i);
  }, 60_000);

  it("does not false-positive on a normal small workbook (passes the size guard)", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", "<workbook><sheets></sheets></workbook>");
    zip.file("xl/_rels/workbook.xml.rels", "<Relationships></Relationships>");
    zip.file("xl/sharedStrings.xml", "<sst></sst>");
    const buffer = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });

    // It gets PAST the bomb guard and reaches the real structural validation
    // (no "Master Data View" sheet) — i.e. the size guard did not reject it.
    await expect(parseLegacyWorkbook(buffer, [])).rejects.toThrow(/Master Data View/);
  });
});
