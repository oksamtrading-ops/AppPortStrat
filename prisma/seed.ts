/**
 * Reference-data seed — SAFE ON ANY DATABASE (no identities, no sample data).
 * Populates the global question bank from content extracted verbatim from the
 * APS v5.0 workbook (prisma/seed-data/question-content.json): question texts,
 * descriptions, sections, and all 1–5 guideline anchors (CLAUDE.md seed
 * mandate; inventory §2.2).
 *
 * Run: npm run db:seed   (idempotent — rebuilds the bank at BANK_VERSION)
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const BANK_VERSION = 1;

interface ExtractedQuestion {
  row: number;
  section: string;
  name: string;
  description: string | null;
  anchors: Record<string, string | null>;
}

interface QuestionContent {
  it: ExtractedQuestion[];
  business: ExtractedQuestion[];
}

/** Stable code per workbook row (inventory §2.2 row layout). */
const IT_CODES: Record<number, string> = {
  10: "IT_TC_AVAILABILITY",
  11: "IT_TC_SUPPORT_COMPLEXITY",
  12: "IT_TC_SUPPORT_VOLUME",
  13: "IT_TC_TECHNICAL_CAPABILITY",
  14: "IT_TC_ABILITY_TO_UPGRADE",
  15: "IT_TC_SLA_COMPLIANCE",
  16: "IT_TC_APP_STABILITY",
  17: "IT_TC_DR_CAPABILITY",
  18: "IT_TC_SCALABILITY",
  19: "IT_TC_ADAPTABILITY",
  20: "IT_TC_PORTABILITY",
  21: "IT_TC_QUALITY",
  22: "IT_TC_PERFORMANCE",
  23: "IT_TC_MAINTAINABILITY",
  26: "IT_AI_COMPLEXITY",
  27: "IT_AI_REUSABILITY",
  28: "IT_AI_EA_STANDARDS",
  31: "IT_TR_DR_CRITICALITY",
  32: "IT_TR_VENDOR_DB",
  33: "IT_TR_VENDOR_PLATFORM",
  34: "IT_TR_VENDOR_INTEGRATION",
  35: "IT_TR_SECURITY",
  36: "IT_TR_CAPACITY",
  37: "IT_TR_SPECIALIZED_KNOWLEDGE",
  46: "IT_NR_BUSINESS_CRITICALITY",
  47: "IT_NR_DATA_SENSITIVITY",
  48: "IT_NR_MULTI_BUSINESS",
  49: "IT_NR_STRATEGIC_IT_ALIGNMENT",
};

const BV_CODES: Record<number, string> = {
  11: "BV_SI_BUS_UNITS",
  12: "BV_SI_FUNC_ALIGNMENT",
  13: "BV_SI_IMPORTANCE_BU",
  14: "BV_SI_BUSINESS_VALUE",
  15: "BV_SI_PURPOSE",
  18: "BV_OP_OWNER_SATISFACTION",
  19: "BV_OP_USER_INTERFACE",
  20: "BV_OP_USER_SATISFACTION",
  21: "BV_OP_BUSINESS_CAPABILITIES",
  22: "BV_OP_FUTURE_REQUIREMENTS",
  23: "BV_OP_OPERATIONAL_EFFICIENCY",
};

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const content: QuestionContent = JSON.parse(
    readFileSync(join(__dirname, "seed-data", "question-content.json"), "utf8"),
  );

  const templates: Array<{
    type: "IT_HEALTH" | "BUSINESS_VALUE" | "DEMOGRAPHICS" | "FINANCE";
    name: string;
    sheet: string;
    questions: ExtractedQuestion[];
    codes: Record<number, string>;
  }> = [
    { type: "IT_HEALTH", name: "IT Health Survey", sheet: "IT", questions: content.it, codes: IT_CODES },
    { type: "BUSINESS_VALUE", name: "Business Value Survey", sheet: "Business", questions: content.business, codes: BV_CODES },
    // Question sets for these two land in Phase 3 (Demographics 119 fields, Finance line items).
    { type: "DEMOGRAPHICS", name: "Demographics Survey", sheet: "Demographics", questions: [], codes: {} },
    { type: "FINANCE", name: "Finance Survey", sheet: "Finance", questions: [], codes: {} },
  ];

  for (const t of templates) {
    const template = await prisma.bankTemplate.upsert({
      where: { type: t.type },
      create: { type: t.type, name: t.name, bankVersion: BANK_VERSION },
      update: { name: t.name, bankVersion: BANK_VERSION },
    });

    if (t.questions.length === 0) continue;

    // Idempotent rebuild of the bank's question set at this version.
    await prisma.bankQuestion.deleteMany({ where: { templateId: template.id } });

    let orderIndex = 0;
    for (const q of t.questions) {
      const code = t.codes[q.row];
      if (!code) throw new Error(`No code mapping for ${t.sheet} row ${q.row} (${q.name})`);
      const scoreFamily =
        t.type === "BUSINESS_VALUE" ? "BUSINESS" : code.startsWith("IT_NR_") ? "IT_NON_REPORT" : "IT";

      const question = await prisma.bankQuestion.create({
        data: {
          templateId: template.id,
          code,
          section: q.section,
          text: q.name,
          description: q.description,
          orderIndex: orderIndex++,
          scoreFamily,
          answerKind: "SCORE_1_5",
          legacyRef: `${t.sheet}!row${q.row}`,
        },
      });

      for (const value of [1, 2, 3, 4, 5] as const) {
        const text = q.anchors[String(value)];
        if (text) {
          await prisma.bankAnchor.create({ data: { questionId: question.id, value, text } });
        }
      }
    }
    console.log(`Seeded ${t.type}: ${t.questions.length} questions`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
