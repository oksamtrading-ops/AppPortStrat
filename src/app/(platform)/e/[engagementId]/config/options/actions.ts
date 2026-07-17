"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";

export async function addOptionItem(formData: FormData) {
  const parsed = z
    .object({
      engagementId: z.string().min(1),
      optionListId: z.string().min(1),
      value: z.string().trim().min(1).max(200),
    })
    .parse({
      engagementId: formData.get("engagementId"),
      optionListId: formData.get("optionListId"),
      value: formData.get("value"),
    });
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  const list = await db.optionList.findUnique({
    where: { id: parsed.optionListId },
    include: { items: { orderBy: { orderIndex: "desc" }, take: 1 } },
  });
  if (!list) throw new Error("Unknown option list");

  await db.optionItem.create({
    data: {
      engagementId: ctx.engagementId,
      optionListId: list.id,
      value: parsed.value,
      orderIndex: (list.items[0]?.orderIndex ?? -1) + 1,
    },
  });
  await writeAudit(db, ctx, {
    action: "optionList.addItem",
    entityType: "OptionList",
    entityId: list.id,
    after: { list: list.key, value: parsed.value },
  });
  revalidatePath(`/e/${ctx.engagementId}/config/options`);
}

export async function removeOptionItem(formData: FormData) {
  const parsed = z
    .object({ engagementId: z.string().min(1), itemId: z.string().min(1) })
    .parse({ engagementId: formData.get("engagementId"), itemId: formData.get("itemId") });
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  const item = await db.optionItem.findUnique({ where: { id: parsed.itemId }, include: { list: true } });
  if (!item) throw new Error("Unknown option item");

  await db.optionItem.delete({ where: { id: item.id } });
  await writeAudit(db, ctx, {
    action: "optionList.removeItem",
    entityType: "OptionList",
    entityId: item.optionListId,
    before: { list: item.list.key, value: item.value },
  });
  revalidatePath(`/e/${ctx.engagementId}/config/options`);
}
