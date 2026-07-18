/**
 * The single recompute path — two grains (review finding H1):
 * - recomputeApplication: answer saves / scope-flag edits / override changes
 *   affect exactly one app's scores. Milliseconds; safe behind autosave.
 * - recomputeEngagement: config changes (weightings, thresholds, strict-mode)
 *   — rare, Lead-only, advisory-locked, bumps configVersion.
 *
 * Both: scoped reads → pure engine (rowsToSnapshot → computePortfolio) →
 * short write-only transaction via the admin door.
 */
import { computePortfolio } from "@/lib/methodology";
import { THRESHOLD_DEFAULTS } from "@/lib/engagement-defaults";
import { rowsToSnapshot, type SnapshotRows } from "./recompute-core";
import { persistPortfolioResults } from "./db/admin";
import { getScopedDb, type EngagementContext, type ScopedDb } from "./db/scoped";

export interface EngagementConfigShape {
  strictWorkbookScoring: boolean;
}

/**
 * Recompute is SYSTEM work triggered by a user action: a Client Respondent's
 * answer must re-score the app even though respondents cannot read weightings
 * or thresholds themselves. Snapshot reads therefore run under a
 * role-elevated context that KEEPS the caller's engagement — tenancy is
 * unchanged, only role scoping is lifted, and only inside this trusted module.
 */
function systemDb(ctx: EngagementContext): ScopedDb {
  return getScopedDb({ ...ctx, role: "ENGAGEMENT_LEAD", readOnly: false });
}

async function loadSnapshotRows(
  db: ScopedDb,
  engagement: EngagementConfigShape,
  applicationId?: string,
): Promise<SnapshotRows> {
  const [thresholdRow, weightingRows, appRows, answerRows] = await Promise.all([
    db.thresholdConfig.findFirst(),
    db.questionWeighting.findMany({
      select: { importanceRating: true, question: { select: { code: true, scoreFamily: true } } },
    }),
    db.application.findMany({
      where: applicationId ? { id: applicationId } : undefined,
      select: {
        id: true,
        inScope: true,
        isUtilized: true,
        isReplaced: true,
        inFlight: true,
        override: { select: { disposition: true, justification: true } },
      },
    }),
    db.answer.findMany({
      where: {
        question: { scoreFamily: { in: ["BUSINESS", "IT", "IT_NON_REPORT"] } },
        ...(applicationId ? { response: { applicationId } } : {}),
      },
      select: {
        isNA: true,
        numericValue: true,
        question: { select: { code: true, scoreFamily: true } },
        response: { select: { applicationId: true } },
      },
    }),
  ]);

  return {
    strictWorkbookScoring: engagement.strictWorkbookScoring,
    thresholds: {
      optBv: thresholdRow?.optBv ?? THRESHOLD_DEFAULTS.optBv,
      urgBv: thresholdRow?.urgBv ?? THRESHOLD_DEFAULTS.urgBv,
      optIt: thresholdRow?.optIt ?? THRESHOLD_DEFAULTS.optIt,
      urgIt: thresholdRow?.urgIt ?? THRESHOLD_DEFAULTS.urgIt,
    },
    weightings: weightingRows.map((w) => ({
      code: w.question.code,
      scoreFamily: w.question.scoreFamily,
      importanceRating: w.importanceRating,
    })),
    apps: appRows.map((app) => ({
      id: app.id,
      inScope: app.inScope,
      isUtilized: app.isUtilized,
      isReplaced: app.isReplaced,
      inFlight: app.inFlight,
      override:
        app.override && app.override.disposition !== "UNKNOWN"
          ? {
              disposition: app.override.disposition as "REDESIGN" | "KEEP_AS_IS" | "TERMINATE" | "RETOOL",
              justification: app.override.justification,
            }
          : null,
    })),
    answers: answerRows.map((a) => ({
      applicationId: a.response.applicationId,
      code: a.question.code,
      scoreFamily: a.question.scoreFamily,
      isNA: a.isNA,
      numericValue: a.numericValue,
    })),
  };
}

/** Full-portfolio recompute for config changes. Logs its duration (<1s NFR). */
export async function recomputeEngagement(
  ctx: EngagementContext,
  _db: ScopedDb, // kept for call-site symmetry; reads use systemDb(ctx)
  engagement: EngagementConfigShape,
): Promise<{ appCount: number; durationMs: number }> {
  const t0 = performance.now();
  const rows = await loadSnapshotRows(systemDb(ctx), engagement);
  const results = computePortfolio(rowsToSnapshot(rows));
  await persistPortfolioResults(ctx.engagementId, results, { bumpConfigVersion: true });
  const durationMs = Math.round(performance.now() - t0);
  console.info(`[aps] recomputeEngagement(${ctx.engagementId}): ${results.length} apps in ${durationMs}ms`);
  return { appCount: results.length, durationMs };
}

/** Single-application recompute for answer/flag/override changes. */
export async function recomputeApplication(
  ctx: EngagementContext,
  _db: ScopedDb, // kept for call-site symmetry; reads use systemDb(ctx)
  engagement: EngagementConfigShape,
  applicationId: string,
): Promise<void> {
  const rows = await loadSnapshotRows(systemDb(ctx), engagement, applicationId);
  const results = computePortfolio(rowsToSnapshot(rows));
  await persistPortfolioResults(ctx.engagementId, results, { bumpConfigVersion: false });
}
