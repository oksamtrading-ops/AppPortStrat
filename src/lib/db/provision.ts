/**
 * Engagement provisioning (admin door — Platform Admin only upstream).
 * APP-SPEC §4.1: create with defaults, or clone CONFIGURATION (weightings,
 * thresholds, capability model, option lists) from a prior engagement —
 * never data (applications, responses, answers, costs).
 */
import { getRawPrisma } from "./prisma";
import { cloneLibraryNodesInTx } from "./library";
import {
  APS50_PRESET,
  DEFAULT_IMPORTANCE_RATING,
  DEFAULT_OPTION_LISTS,
  THRESHOLD_DEFAULTS,
} from "@/lib/engagement-defaults";

export type EngagementSeedSource =
  | { kind: "defaults"; preset?: "NEUTRAL" | "APS50" }
  | { kind: "clone"; sourceEngagementId: string };

export interface CreateEngagementParams {
  name: string;
  clientName: string;
  currency?: string;
  fiscalYearConvention?: string;
  clerkOrgId?: string | null;
  source: EngagementSeedSource;
  /**
   * Optional industry starter pack for the capability model. Ignored when
   * cloning from a prior engagement (the clone's tree wins).
   */
  capabilityLibraryId?: string | null;
}

export async function createEngagementWithConfig(params: CreateEngagementParams) {
  const db = getRawPrisma();

  return db.$transaction(async (tx) => {
    const engagement = await tx.engagement.create({
      data: {
        name: params.name,
        clientName: params.clientName,
        currency: params.currency ?? "USD",
        fiscalYearConvention: params.fiscalYearConvention ?? "FY",
        clerkOrgId: params.clerkOrgId ?? null,
      },
    });
    // Set the engagement GUC so the child writes below satisfy FORCE'd RLS on
    // this admin-door transaction (defense-in-depth, hardening.sql).
    await tx.$executeRaw`SELECT set_config('app.engagement_id', ${engagement.id}, TRUE)`;

    // 1. Clone the survey templates/questions/anchors from the global bank
    //    (always — the question set is methodology, not configuration).
    //    Batched (createManyAndReturn) — row-by-row creates blow the
    //    transaction timeout on pooled hosted Postgres.
    const bankTemplates = await tx.bankTemplate.findMany({
      include: { questions: { include: { anchors: true }, orderBy: { orderIndex: "asc" } } },
    });
    const questionIdByCode = new Map<string, string>();
    for (const bank of bankTemplates) {
      const template = await tx.surveyTemplate.create({
        data: {
          engagementId: engagement.id,
          type: bank.type,
          name: bank.name,
          bankVersion: bank.bankVersion,
        },
      });
      if (bank.questions.length === 0) continue;

      const created = await tx.surveyQuestion.createManyAndReturn({
        data: bank.questions.map((q) => ({
          engagementId: engagement.id,
          templateId: template.id,
          code: q.code,
          section: q.section,
          text: q.text,
          description: q.description,
          orderIndex: q.orderIndex,
          scoreFamily: q.scoreFamily,
          answerKind: q.answerKind,
          optionListKey: q.optionListKey,
          legacyRef: q.legacyRef,
        })),
        select: { id: true, code: true },
      });
      for (const q of created) questionIdByCode.set(q.code, q.id);

      const anchorRows = bank.questions.flatMap((q) =>
        q.anchors.map((a) => ({
          engagementId: engagement.id,
          questionId: questionIdByCode.get(q.code)!,
          value: a.value,
          text: a.text,
        })),
      );
      if (anchorRows.length > 0) {
        await tx.guidelineAnchor.createMany({ data: anchorRows });
      }
    }

    // 2. Configuration: defaults/preset, or cloned from a prior engagement.
    if (params.source.kind === "defaults") {
      const preset = params.source.preset ?? "NEUTRAL";
      const aps50 = new Set<string>([...APS50_PRESET.bv, ...APS50_PRESET.it]);
      const scoredCodes = [...questionIdByCode.entries()];
      await tx.questionWeighting.createMany({
        data: scoredCodes.map(([code, questionId]) => ({
          engagementId: engagement.id,
          questionId,
          importanceRating:
            preset === "APS50" && !code.startsWith("IT_NR_")
              ? aps50.has(code)
                ? 5
                : 0
              : DEFAULT_IMPORTANCE_RATING,
        })),
      });

      await tx.thresholdConfig.create({ data: { engagementId: engagement.id, ...THRESHOLD_DEFAULTS } });

      for (const list of DEFAULT_OPTION_LISTS) {
        const created = await tx.optionList.create({
          data: { engagementId: engagement.id, key: list.key, name: list.name },
        });
        if (list.values.length > 0) {
          await tx.optionItem.createMany({
            data: list.values.map((value, orderIndex) => ({
              engagementId: engagement.id,
              optionListId: created.id,
              value,
              orderIndex,
            })),
          });
        }
      }
    } else {
      const sourceId = params.source.sourceEngagementId;

      // Weightings map across engagements by stable question CODE.
      const sourceWeightings = await tx.questionWeighting.findMany({
        where: { engagementId: sourceId },
        include: { question: { select: { code: true } } },
      });
      await tx.questionWeighting.createMany({
        data: [...questionIdByCode.entries()].map(([code, questionId]) => ({
          engagementId: engagement.id,
          questionId,
          importanceRating:
            sourceWeightings.find((w) => w.question.code === code)?.importanceRating ?? DEFAULT_IMPORTANCE_RATING,
        })),
      });

      const sourceThresholds = await tx.thresholdConfig.findUnique({ where: { engagementId: sourceId } });
      await tx.thresholdConfig.create({
        data: {
          engagementId: engagement.id,
          optBv: sourceThresholds?.optBv ?? THRESHOLD_DEFAULTS.optBv,
          urgBv: sourceThresholds?.urgBv ?? THRESHOLD_DEFAULTS.urgBv,
          optIt: sourceThresholds?.optIt ?? THRESHOLD_DEFAULTS.optIt,
          urgIt: sourceThresholds?.urgIt ?? THRESHOLD_DEFAULTS.urgIt,
          heatT1: sourceThresholds?.heatT1 ?? THRESHOLD_DEFAULTS.heatT1,
          heatT2: sourceThresholds?.heatT2 ?? THRESHOLD_DEFAULTS.heatT2,
        },
      });

      // Option lists.
      const sourceLists = await tx.optionList.findMany({
        where: { engagementId: sourceId },
        include: { items: { orderBy: { orderIndex: "asc" } } },
      });
      for (const list of sourceLists) {
        const created = await tx.optionList.create({
          data: { engagementId: engagement.id, key: list.key, name: list.name },
        });
        if (list.items.length > 0) {
          await tx.optionItem.createMany({
            data: list.items.map((item) => ({
              engagementId: engagement.id,
              optionListId: created.id,
              value: item.value,
              orderIndex: item.orderIndex,
            })),
          });
        }
      }

      // Capability tree: L0 → L1 → L2, remapping parent ids level by level.
      const sourceNodes = await tx.capabilityNode.findMany({ where: { engagementId: sourceId } });
      const nodeIdMap = new Map<string, string>();
      for (const level of ["L0", "L1", "L2"] as const) {
        for (const node of sourceNodes.filter((n) => n.level === level)) {
          const created = await tx.capabilityNode.create({
            data: {
              engagementId: engagement.id,
              parentId: node.parentId ? (nodeIdMap.get(node.parentId) ?? null) : null,
              level: node.level,
              name: node.name,
              isPlaceholder: node.isPlaceholder,
            },
          });
          nodeIdMap.set(node.id, created.id);
        }
      }
    }

    // 3. Capability model from an industry starter pack (not when cloning —
    //    the clone already brought its own tree).
    if (params.capabilityLibraryId && params.source.kind !== "clone") {
      await cloneLibraryNodesInTx(tx, engagement.id, params.capabilityLibraryId);
    }

    return engagement;
  },
  // Hosted Postgres with cold starts: generous headroom for connection
  // acquisition (maxWait) and the provisioning work itself (timeout).
  { maxWait: 15_000, timeout: 30_000 });
}

/**
 * Bring an existing engagement's survey templates up to the current bank
 * version: creates missing templates, adds missing questions (by stable code)
 * with their anchors, and creates neutral weightings for any new SCORED
 * questions. Never modifies or removes existing questions/answers — additive
 * only, so in-flight surveys are untouched.
 */
export async function syncEngagementFromBank(engagementId: string): Promise<{ addedQuestions: number }> {
  const db = getRawPrisma();

  return db.$transaction(
    async (tx) => {
      // Set the engagement GUC so writes to RLS'd survey tables satisfy FORCE'd
      // RLS on this admin-door transaction (defense-in-depth, hardening.sql).
      await tx.$executeRaw`SELECT set_config('app.engagement_id', ${engagementId}, TRUE)`;
      const bankTemplates = await tx.bankTemplate.findMany({
        include: { questions: { include: { anchors: true }, orderBy: { orderIndex: "asc" } } },
      });
      let addedQuestions = 0;

      for (const bank of bankTemplates) {
        let template = await tx.surveyTemplate.findFirst({
          where: { engagementId, type: bank.type },
          include: { questions: { select: { code: true } } },
        });
        if (!template) {
          template = {
            ...(await tx.surveyTemplate.create({
              data: { engagementId, type: bank.type, name: bank.name, bankVersion: bank.bankVersion },
            })),
            questions: [],
          };
        }
        const existingCodes = new Set(template.questions.map((q) => q.code));
        const missing = bank.questions.filter((q) => !existingCodes.has(q.code));
        if (missing.length > 0) {
          const created = await tx.surveyQuestion.createManyAndReturn({
            data: missing.map((q) => ({
              engagementId,
              templateId: template.id,
              code: q.code,
              section: q.section,
              text: q.text,
              description: q.description,
              orderIndex: q.orderIndex,
              scoreFamily: q.scoreFamily,
              answerKind: q.answerKind,
              optionListKey: q.optionListKey,
              legacyRef: q.legacyRef,
            })),
            select: { id: true, code: true, scoreFamily: true },
          });
          const idByCode = new Map(created.map((q) => [q.code, q.id]));

          const anchorRows = missing.flatMap((q) =>
            q.anchors.map((a) => ({
              engagementId,
              questionId: idByCode.get(q.code)!,
              value: a.value,
              text: a.text,
            })),
          );
          if (anchorRows.length > 0) await tx.guidelineAnchor.createMany({ data: anchorRows });

          const scoredNew = created.filter((q) => q.scoreFamily !== "NONE");
          if (scoredNew.length > 0) {
            await tx.questionWeighting.createMany({
              data: scoredNew.map((q) => ({
                engagementId,
                questionId: q.id,
                importanceRating: DEFAULT_IMPORTANCE_RATING,
              })),
            });
          }
          addedQuestions += missing.length;
        }
        if (template.bankVersion !== bank.bankVersion) {
          await tx.surveyTemplate.update({ where: { id: template.id }, data: { bankVersion: bank.bankVersion } });
        }
      }

      return { addedQuestions };
    },
    { maxWait: 15_000, timeout: 60_000 },
  );
}
