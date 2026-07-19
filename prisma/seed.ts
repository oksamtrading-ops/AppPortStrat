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
import { apsPoolConfig } from "../src/lib/db/pg-config";

const BANK_VERSION = 2;

interface ExtractedQuestion {
  row: number;
  section: string;
  name: string;
  description: string | null;
  anchors: Record<string, string | null>;
}

interface FieldRow {
  row: number;
  section: string;
  name: string;
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
  const prisma = new PrismaClient({ adapter: new PrismaPg(apsPoolConfig(connectionString)) });

  const content: QuestionContent = JSON.parse(
    readFileSync(join(__dirname, "seed-data", "question-content.json"), "utf8"),
  );
  const demFin: { demographics: FieldRow[]; finance: FieldRow[] } = JSON.parse(
    readFileSync(join(__dirname, "seed-data", "demographics-finance.json"), "utf8"),
  );

  interface BankQuestionSeed {
    code: string;
    section: string;
    text: string;
    description: string | null;
    scoreFamily: "BUSINESS" | "IT" | "IT_NON_REPORT" | "NONE";
    answerKind: "SCORE_1_5" | "TEXT" | "NUMBER" | "CURRENCY" | "DATE" | "BOOLEAN" | "OPTION";
    optionListKey: string | null;
    legacyRef: string;
    anchors: Array<{ value: number; text: string }>;
  }

  function scored(sheet: string, codes: Record<number, string>, family: "BUSINESS" | "IT") {
    return (q: ExtractedQuestion): BankQuestionSeed => {
      const code = codes[q.row];
      if (!code) throw new Error(`No code mapping for ${sheet} row ${q.row} (${q.name})`);
      return {
        code,
        section: q.section,
        text: q.name,
        description: q.description,
        scoreFamily: family === "IT" && code.startsWith("IT_NR_") ? "IT_NON_REPORT" : family,
        answerKind: "SCORE_1_5",
        optionListKey: null,
        legacyRef: `${sheet}!row${q.row}`,
        anchors: [1, 2, 3, 4, 5]
          .map((value): { value: number; text: string | null } => ({ value, text: q.anchors[String(value)] ?? null }))
          .filter((a): a is { value: number; text: string } => a.text !== null),
      };
    };
  }

  /** Demographics answer kinds follow the workbook's actual validations (inventory §2.5). */
  function demographicsKind(row: number): { answerKind: BankQuestionSeed["answerKind"]; optionListKey: string | null } {
    if ((row >= 29 && row <= 60) || (row >= 121 && row <= 136)) return { answerKind: "BOOLEAN", optionListKey: null }; // Yes/No blocks
    if (row === 69) return { answerKind: "OPTION", optionListKey: "customization" };
    if (row === 84) return { answerKind: "OPTION", optionListKey: "applicationSize" };
    return { answerKind: "TEXT", optionListKey: null };
  }

  const templates: Array<{ type: "IT_HEALTH" | "BUSINESS_VALUE" | "DEMOGRAPHICS" | "FINANCE"; name: string; questions: BankQuestionSeed[] }> = [
    { type: "IT_HEALTH", name: "IT Health Survey", questions: content.it.map(scored("IT", IT_CODES, "IT")) },
    {
      type: "BUSINESS_VALUE",
      name: "Business Value Survey",
      questions: content.business.map(scored("Business", BV_CODES, "BUSINESS")),
    },
    {
      type: "DEMOGRAPHICS",
      name: "Demographics Survey",
      questions: demFin.demographics.map((f) => ({
        code: `DEM_R${String(f.row).padStart(3, "0")}`,
        section: f.section,
        text: f.name,
        description: null,
        scoreFamily: "NONE" as const,
        ...demographicsKind(f.row),
        legacyRef: `Demographics!row${f.row}`,
        anchors: [],
      })),
    },
    {
      type: "FINANCE",
      name: "Finance Survey",
      questions: demFin.finance.map((f) => ({
        code: `FIN_R${String(f.row).padStart(3, "0")}`,
        section: f.section,
        text: f.name,
        description: null,
        scoreFamily: "NONE" as const,
        answerKind: f.section === "Comments" ? ("TEXT" as const) : ("CURRENCY" as const),
        optionListKey: null,
        legacyRef: `Finance!row${f.row}`,
        anchors: [],
      })),
    },
  ];

  for (const t of templates) {
    const template = await prisma.bankTemplate.upsert({
      where: { type: t.type },
      create: { type: t.type, name: t.name, bankVersion: BANK_VERSION },
      update: { name: t.name, bankVersion: BANK_VERSION },
    });

    // Idempotent rebuild of the bank's question set at this version.
    await prisma.bankQuestion.deleteMany({ where: { templateId: template.id } });

    let orderIndex = 0;
    for (const q of t.questions) {
      const question = await prisma.bankQuestion.create({
        data: {
          templateId: template.id,
          code: q.code,
          section: q.section,
          text: q.text,
          description: q.description,
          orderIndex: orderIndex++,
          scoreFamily: q.scoreFamily,
          answerKind: q.answerKind,
          optionListKey: q.optionListKey,
          legacyRef: q.legacyRef,
        },
      });
      if (q.anchors.length > 0) {
        await prisma.bankAnchor.createMany({
          data: q.anchors.map((a) => ({ questionId: question.id, value: a.value, text: a.text })),
        });
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
