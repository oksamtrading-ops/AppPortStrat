/**
 * Engagement provisioning (admin door — Platform Admin only upstream).
 * APP-SPEC §4.1: create with defaults, or clone CONFIGURATION (weightings,
 * thresholds, capability model, option lists) from a prior engagement —
 * never data (applications, responses, answers, costs).
 */
import { getRawPrisma } from "./prisma";
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

    // 1. Clone the survey templates/questions/anchors from the global bank
    //    (always — the question set is methodology, not configuration).
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
      for (const q of bank.questions) {
        const question = await tx.surveyQuestion.create({
          data: {
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
          },
        });
        questionIdByCode.set(q.code, question.id);
        if (q.anchors.length > 0) {
          await tx.guidelineAnchor.createMany({
            data: q.anchors.map((a) => ({
              engagementId: engagement.id,
              questionId: question.id,
              value: a.value,
              text: a.text,
            })),
          });
        }
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
        await tx.optionList.create({
          data: {
            engagementId: engagement.id,
            key: list.key,
            name: list.name,
            items: {
              create: list.values.map((value, orderIndex) => ({
                engagementId: engagement.id,
                value,
                orderIndex,
              })),
            },
          },
        });
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
        await tx.optionList.create({
          data: {
            engagementId: engagement.id,
            key: list.key,
            name: list.name,
            items: {
              create: list.items.map((item) => ({
                engagementId: engagement.id,
                value: item.value,
                orderIndex: item.orderIndex,
              })),
            },
          },
        });
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

    return engagement;
  });
}
