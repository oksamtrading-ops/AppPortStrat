/**
 * Application creation with per-engagement appNumber assignment.
 * appNumber = max + 1 under a retry loop: two concurrent creates can both
 * read the same max; the @@unique([engagementId, appNumber]) constraint makes
 * the loser retry with a fresh number (review finding M8).
 */
import { Prisma } from "@/generated/prisma/client";
import type { ScopedDb } from "./scoped";

export interface NewApplicationData {
  name: string;
  acronym?: string | null;
  description?: string | null;
  applicationType?: string | null;
  businessFunctionDetail?: string | null;
  target?: string | null;
  meetsFutureState?: "YES" | "NO" | "PARTIAL" | null;
  actionPlanAssignment?: string | null;
  actionPlanJustification?: string | null;
  missionCritical?: boolean;
  comments?: string | null;
  inScope?: boolean;
  isUtilized?: boolean;
  isReplaced?: boolean;
  inFlight?: boolean;
  capabilityNodeId?: string | null;
}

export async function createApplicationWithNumber(db: ScopedDb, engagementId: string, data: NewApplicationData) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await db.application.findFirst({
      orderBy: { appNumber: "desc" },
      select: { appNumber: true },
    });
    try {
      return await db.application.create({
        data: { ...data, engagementId, appNumber: (latest?.appNumber ?? 0) + 1 },
      });
    } catch (err) {
      const isDuplicateNumber = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isDuplicateNumber || attempt === 2) throw err;
    }
  }
  throw new Error("unreachable");
}
