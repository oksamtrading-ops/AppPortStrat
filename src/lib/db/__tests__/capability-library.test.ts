import { describe, it, expect, afterAll } from "vitest";

/**
 * Capability reference library round-trip (integration; skipped without a DB):
 * create pack → provision engagement from it (provenance stamps intact) →
 * promote the refined tree back as a new pack preserving stable codes.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("capability library (integration)", () => {
  const cleanups: (() => Promise<void>)[] = [];

  afterAll(async () => {
    for (const fn of cleanups.reverse()) await fn();
  });

  it("clones a pack into a new engagement with provenance, then promotes it back", async () => {
    const { createCapabilityLibrary, promoteEngagementTreeToLibrary } = await import("../library");
    const { createEngagementWithConfig } = await import("../provision");
    const { getRawPrisma } = await import("../prisma");
    const db = getRawPrisma();
    const tag = `__libtest_${Date.now()}`;

    const library = await createCapabilityLibrary({
      industry: tag,
      name: "Test Pack",
      description: "test",
      tree: [
        {
          code: "FIN",
          name: "Finance",
          description: "Money things",
          children: [{ code: "FIN.ACC", name: "Accounting", children: [{ code: "FIN.ACC.GL", name: "General Ledger" }] }],
        },
      ],
    });
    cleanups.push(async () => {
      await db.capabilityLibrary.deleteMany({ where: { industry: tag } });
    });

    const engagement = await createEngagementWithConfig({
      name: `${tag} engagement`,
      clientName: "Test Co",
      source: { kind: "defaults" },
      capabilityLibraryId: library.id,
    });
    cleanups.push(async () => {
      await db.engagement.delete({ where: { id: engagement.id } });
    });

    const nodes = await db.capabilityNode.findMany({ where: { engagementId: engagement.id } });
    expect(nodes).toHaveLength(3);
    const fin = nodes.find((n) => n.name === "Finance")!;
    expect(fin.level).toBe("L0");
    expect(fin.description).toBe("Money things");
    expect(fin.sourceLibraryId).toBe(library.id);
    expect(fin.sourceCode).toBe("FIN");
    const gl = nodes.find((n) => n.name === "General Ledger")!;
    expect(gl.level).toBe("L2");
    expect(gl.sourceCode).toBe("FIN.ACC.GL");

    // Refine (rename) then promote back: codes survive, the rename is captured.
    await db.capabilityNode.update({ where: { id: fin.id }, data: { name: "Finance & Treasury" } });
    const promoted = await promoteEngagementTreeToLibrary(engagement.id, {
      industry: tag,
      name: "Promoted Pack",
      createdBy: "Test Lead",
    });
    expect(promoted.version).toBe(1);
    const promotedNodes = await db.capabilityLibraryNode.findMany({ where: { libraryId: promoted.id } });
    expect(promotedNodes).toHaveLength(3);
    const promotedFin = promotedNodes.find((n) => n.code === "FIN")!;
    expect(promotedFin.name).toBe("Finance & Treasury");

    // A second pack under the same (industry, name) becomes version 2.
    const v2 = await promoteEngagementTreeToLibrary(engagement.id, {
      industry: tag,
      name: "Promoted Pack",
      createdBy: "Test Lead",
    });
    expect(v2.version).toBe(2);
  }, 90_000);
});
