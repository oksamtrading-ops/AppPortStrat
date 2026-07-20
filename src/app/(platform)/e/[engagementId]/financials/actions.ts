"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/db/admin";

/**
 * Fiscal-year cost dataset paste-import (the Financial Data sheet's role,
 * APP-SPEC §4.11): flat rows keyed by application and version. Costs are
 * context only — never an input to disposition.
 */
export async function importCostRecords(input: { engagementId: string; text: string }) {
  const parsed = z
    .object({ engagementId: z.string().min(1), text: z.string().min(1).max(2_000_000) })
    .parse(input);
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  const rl = await rateLimit(`import:${ctx.membershipId}`, 5, 60);
  if (!rl.allowed) return { ok: false as const, error: "Too many imports — wait a minute and try again." };

  const { parseTsvWithHeader } = await import("@/lib/tabular");
  const { records } = parseTsvWithHeader(parsed.text, {
    app: ["app", "application", "applicationname", "appname", "number", "app#", "appnumber"],
    fiscalYear: ["fiscalyear", "fy", "year"],
    version: ["version", "versiontype"],
    category: ["category"],
    lineItem: ["lineitem", "item", "line"],
    amount: ["amount", "cost", "value"],
  });
  if (records.length === 0) return { ok: false as const, error: "No data rows found — paste with a header row" };
  if (records.length > 5000) return { ok: false as const, error: "Paste is limited to 5,000 rows at a time" };

  const apps = await db.application.findMany({ select: { id: true, appNumber: true, name: true } });
  const byNumber = new Map(apps.map((a) => [String(a.appNumber), a.id]));
  const byName = new Map(apps.map((a) => [a.name.trim().toLowerCase(), a.id]));

  const VERSION_MAP: Record<string, "ACTUAL" | "BUDGET" | "FORECAST"> = {
    actual: "ACTUAL",
    budget: "BUDGET",
    forecast: "FORECAST",
  };

  const rows: Array<{
    applicationId: string;
    fiscalYear: string;
    versionType: "ACTUAL" | "BUDGET" | "FORECAST";
    category: string;
    lineItem: string;
    amount: number;
  }> = [];
  let skipped = 0;
  for (const r of records) {
    const applicationId = r.app ? (byNumber.get(r.app) ?? byName.get(r.app.trim().toLowerCase())) : undefined;
    const versionKey = (r.version ?? "").trim().toLowerCase().replace(/^fy\d+[_\s-]*/, "");
    const versionType = VERSION_MAP[versionKey];
    const amount = Number((r.amount ?? "").replace(/[$,\s]/g, ""));
    if (!applicationId || !r.fiscalYear || !versionType || !r.category || !Number.isFinite(amount)) {
      skipped += 1;
      continue;
    }
    rows.push({
      applicationId,
      fiscalYear: r.fiscalYear.slice(0, 40),
      versionType,
      category: r.category.slice(0, 200),
      lineItem: (r.lineItem ?? r.category).slice(0, 200),
      amount,
    });
  }
  if (rows.length === 0) {
    return { ok: false as const, error: "No importable rows (need App, Fiscal Year, Version = Actual/Budget/Forecast, Category, Amount)" };
  }

  await db.costRecord.createMany({
    data: rows.map((r) => ({ ...r, engagementId: ctx.engagementId })),
  });

  await writeAudit(db, ctx, {
    action: "import.costRecords",
    entityType: "CostRecord",
    after: { imported: rows.length, skipped },
  });
  revalidatePath(`/e/${ctx.engagementId}/financials`);
  return { ok: true as const, imported: rows.length, skipped };
}

export async function clearCostRecords(formData: FormData) {
  const parsed = z.object({ engagementId: z.string().min(1) }).parse({ engagementId: formData.get("engagementId") });
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");
  const { count } = await db.costRecord.deleteMany({});
  await writeAudit(db, ctx, { action: "costRecords.clear", entityType: "CostRecord", before: { rows: count } });
  revalidatePath(`/e/${ctx.engagementId}/financials`);
}
