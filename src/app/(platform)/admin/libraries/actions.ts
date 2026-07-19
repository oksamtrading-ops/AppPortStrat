"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { parseCapabilityImport, UNASSIGNED } from "@/lib/methodology";
import { createCapabilityLibrary, type LibraryTreeNode } from "@/lib/db/library";

const createSchema = z.object({
  industry: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  text: z.string().min(1).max(500_000),
});

/** Curate a pack from a pasted table; codes are slugged from the name path. */
export async function createLibraryFromPasteAction(formData: FormData) {
  const session = await requirePlatformAdmin();
  const parsed = createSchema.parse({
    industry: formData.get("industry"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    text: formData.get("text"),
  });

  const { tree, rowCount } = parseCapabilityImport(parsed.text);
  if (rowCount > 5000) throw new Error("Paste is limited to 5,000 rows at a time");

  const taken = new Set<string>();
  const slug = (name: string) => {
    const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "NODE";
    let code = base;
    let i = 2;
    while (taken.has(code)) code = `${base}_${i++}`;
    taken.add(code);
    return code;
  };

  // Placeholder-only branches ("Unassigned") are paste artifacts, not pack content.
  const roots: LibraryTreeNode[] = [...tree.entries()]
    .filter(([l0]) => l0 !== UNASSIGNED)
    .map(([l0, l1Map]) => ({
      code: slug(l0),
      name: l0,
      children: [...l1Map.entries()]
        .filter(([l1]) => l1 !== UNASSIGNED)
        .map(([l1, l2Set]) => ({
          code: slug(`${l0} ${l1}`),
          name: l1,
          children: [...l2Set].map((l2) => ({ code: slug(`${l0} ${l1} ${l2}`), name: l2 })),
        })),
    }));

  await createCapabilityLibrary({
    industry: parsed.industry,
    name: parsed.name,
    description: parsed.description ?? null,
    attribution: `Curated by ${session.displayName}`,
    createdBy: session.displayName,
    tree: roots,
  });

  revalidatePath("/admin/libraries");
}
