/**
 * Pure tenancy guard — the argument-inspection core of the scoped Prisma
 * client. No Prisma imports, no I/O: golden test 26 runs this as a plain unit
 * test with no database.
 *
 * Philosophy: DEFAULT-DENY. Any model or operation shape not explicitly
 * handled here throws. Foreign engagement references are REJECTED, never
 * silently rewritten. The database backs this up with composite
 * (id, engagementId) foreign keys and row-level security — the guard is the
 * first line, not the only one.
 */

export class TenancyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenancyViolationError";
  }
}

export type GuardRole = "ENGAGEMENT_LEAD" | "CONSULTANT" | "CLIENT_RESPONDENT" | "CLIENT_VIEWER";

export interface GuardContext {
  engagementId: string;
  membershipId: string;
  role: GuardRole;
  /** True for ARCHIVED / PENDING_PURGE engagements — all writes denied. */
  readOnly: boolean;
}

/** Models with no engagementId (or global reference data) — never accessible via the scoped client. */
const DENIED_MODELS = new Set([
  "Engagement",
  "BankTemplate",
  "BankQuestion",
  "BankAnchor",
  "EngagementTombstone",
  "CapabilityLibrary",
  "CapabilityLibraryNode",
]);

/** Append-only models: reads + create only, for every role. */
const APPEND_ONLY_MODELS = new Set(["AuditEvent"]);

const READ_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

/** Ops whose `where` is a unique selector — engagementId is spread in as a sibling filter. */
const UNIQUE_WHERE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);

const WRITE_OPS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

/** Client Respondent model allowlist (APP-SPEC §2: assigned applications' surveys only). */
const RESPONDENT_READ_MODELS = new Set([
  "Application",
  "SurveyAssignment",
  "SurveyTemplate",
  "SurveyQuestion",
  "GuidelineAnchor",
  "SurveyResponse",
  "Answer",
  "OptionList",
  "OptionItem",
]);

const RESPONDENT_WRITE_OPS: Record<string, ReadonlySet<string>> = {
  // deleteMany carries the injected assignment predicate; "clear answer" uses it.
  Answer: new Set(["create", "update", "upsert", "delete", "deleteMany"]),
  // create/upsert: a respondent's first answer materializes the response row;
  // the autosave action MUST pre-verify assignment via a respondent-scoped read.
  SurveyResponse: new Set(["create", "update", "upsert"]),
};

/**
 * model → { relationField → target model }. The top-level model's `where` is
 * predicate-scoped, but relations pulled via `include`/`select` are NOT — so a
 * respondent-reachable read could traverse into a role-denied model (scores,
 * costs, other members) within their own tenant (security review F2). This map
 * lets the guard re-check every included/selected relation's target model.
 *
 * Kept in lockstep with the Prisma schema by a drift test
 * (relation-map.drift.test.ts) that parses schema.prisma and fails on any
 * mismatch — so this can't silently rot. Pure data (no Prisma import) keeps
 * the guard unit-testable without a database.
 */
const RELATION_MAP: Record<string, Record<string, string>> = {
  Engagement: {
    memberships: "Membership", applications: "Application", capabilityNodes: "CapabilityNode",
    surveyTemplates: "SurveyTemplate", surveyQuestions: "SurveyQuestion", guidelineAnchors: "GuidelineAnchor",
    questionWeightings: "QuestionWeighting", thresholdConfig: "ThresholdConfig", surveyAssignments: "SurveyAssignment",
    surveyResponses: "SurveyResponse", answers: "Answer", dispositionResults: "DispositionResult",
    dispositionOverrides: "DispositionOverride", costRecords: "CostRecord", optionLists: "OptionList",
    optionItems: "OptionItem", auditEvents: "AuditEvent", commentThreads: "Comment", notifications: "Notification",
  },
  Membership: { engagement: "Engagement", assignments: "SurveyAssignment", authoredComments: "Comment", notifications: "Notification" },
  BankTemplate: { questions: "BankQuestion" },
  BankQuestion: { template: "BankTemplate", anchors: "BankAnchor" },
  BankAnchor: { question: "BankQuestion" },
  SurveyTemplate: { engagement: "Engagement", questions: "SurveyQuestion", assignments: "SurveyAssignment", responses: "SurveyResponse" },
  SurveyQuestion: { engagement: "Engagement", template: "SurveyTemplate", anchors: "GuidelineAnchor", weighting: "QuestionWeighting", answers: "Answer" },
  GuidelineAnchor: { engagement: "Engagement", question: "SurveyQuestion" },
  QuestionWeighting: { engagement: "Engagement", question: "SurveyQuestion" },
  ThresholdConfig: { engagement: "Engagement" },
  Application: { engagement: "Engagement", assignments: "SurveyAssignment", responses: "SurveyResponse", result: "DispositionResult", override: "DispositionOverride", costRecords: "CostRecord", commentThreads: "Comment" },
  CapabilityNode: { engagement: "Engagement", parent: "CapabilityNode", children: "CapabilityNode" },
  SurveyAssignment: { engagement: "Engagement", application: "Application", template: "SurveyTemplate", membership: "Membership" },
  SurveyResponse: { engagement: "Engagement", application: "Application", template: "SurveyTemplate", answers: "Answer" },
  Answer: { engagement: "Engagement", response: "SurveyResponse", question: "SurveyQuestion" },
  DispositionResult: { engagement: "Engagement", application: "Application" },
  DispositionOverride: { engagement: "Engagement", application: "Application" },
  CostRecord: { engagement: "Engagement", application: "Application" },
  OptionList: { engagement: "Engagement", items: "OptionItem" },
  OptionItem: { engagement: "Engagement", list: "OptionList" },
  AuditEvent: { engagement: "Engagement" },
  Comment: { engagement: "Engagement", application: "Application", author: "Membership", parent: "Comment", replies: "Comment" },
  Notification: { engagement: "Engagement", recipient: "Membership" },
  EngagementTombstone: {},
  RateLimitHit: {},
  CapabilityLibrary: { nodes: "CapabilityLibraryNode" },
  CapabilityLibraryNode: {
    library: "CapabilityLibrary",
    parent: "CapabilityLibraryNode",
    children: "CapabilityLibraryNode",
  },
};

export const RELATION_MAP_FOR_TEST = RELATION_MAP;

/**
 * For a CLIENT_RESPONDENT read, verify every relation reached via include/select
 * targets a model they may read; deny unknown relations (default-deny). Recurses
 * into nested include/select. `_count` selects only aggregate counts → allowed.
 */
function assertRespondentRelations(model: string, node: Record<string, unknown> | undefined): void {
  if (!node) return;
  const check = (field: string, value: unknown) => {
    const target = RELATION_MAP[model]?.[field];
    if (!target) {
      throw new TenancyViolationError(`Client Respondents cannot traverse ${model}.${field}`);
    }
    if (!RESPONDENT_READ_MODELS.has(target)) {
      throw new TenancyViolationError(`Client Respondents cannot read ${target} via ${model}.${field}`);
    }
    if (value !== null && typeof value === "object") {
      assertRespondentRelations(target, value as Record<string, unknown>);
    }
  };

  const include = node.include as Record<string, unknown> | undefined;
  for (const [field, value] of Object.entries(include ?? {})) {
    if (value === false) continue;
    check(field, value);
  }
  const select = node.select as Record<string, unknown> | undefined;
  for (const [field, value] of Object.entries(select ?? {})) {
    if (field === "_count") continue; // aggregate count only, no row data
    // Scalar selects are `field: true/false`; a relation select is an object.
    if (value !== null && typeof value === "object") check(field, value);
  }
}

/**
 * Relation predicates confining a Client Respondent to their assigned
 * applications. Injected into every where clause. (Creates cannot carry a
 * predicate — the survey autosave action MUST pre-verify assignment through a
 * respondent-scoped read of the target SurveyResponse.)
 */
function respondentPredicate(model: string, membershipId: string): Record<string, unknown> | null {
  switch (model) {
    case "Application":
      return { assignments: { some: { membershipId } } };
    case "SurveyAssignment":
      return { membershipId };
    case "SurveyResponse":
      return { application: { assignments: { some: { membershipId } } } };
    case "Answer":
      return { response: { application: { assignments: { some: { membershipId } } } } };
    default:
      return null; // engagement-level reference data (templates, questions, option lists)
  }
}

/**
 * Deep-walk the args tree and reject any explicit reference to a different
 * engagement — whether a scalar `engagementId` or a relation
 * `engagement: { connect: … }`.
 */
function assertNoForeignEngagement(node: unknown, engagementId: string, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => assertNoForeignEngagement(item, engagementId, `${path}[${i}]`));
    return;
  }
  if (node === null || typeof node !== "object") return;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "engagementId" && typeof value === "string" && value !== engagementId) {
      throw new TenancyViolationError(`Foreign engagementId "${value}" at ${path}.${key} (context: ${engagementId})`);
    }
    if (key === "engagement" && value !== null && typeof value === "object") {
      const connect = (value as Record<string, unknown>).connect;
      if (connect !== null && typeof connect === "object") {
        const id = (connect as Record<string, unknown>).id;
        if (typeof id === "string" && id !== engagementId) {
          throw new TenancyViolationError(`Foreign engagement connect "${id}" at ${path}.${key}`);
        }
      }
    }
    assertNoForeignEngagement(value, engagementId, `${path}.${key}`);
  }
}

function withScope(where: unknown, scope: Record<string, unknown>): Record<string, unknown> {
  if (where === undefined || where === null) return scope;
  return { AND: [where, scope] };
}

/**
 * Includes/selects are NOT predicate-scoped (security review F2), so models
 * whose visibility depends on a ROW-level rule must be queried top-level:
 *  - Notification: own-recipient rows only — never traversable, any role.
 *  - Comment: Client Viewers see internal:false only — not traversable by them.
 */
function assertRestrictedRelations(model: string, node: Record<string, unknown> | undefined, ctx: GuardContext): void {
  if (!node) return;
  const check = (field: string, value: unknown) => {
    const target = RELATION_MAP[model]?.[field];
    if (!target) return; // unknown fields are scalars or caught elsewhere
    if (target === "Notification") {
      throw new TenancyViolationError(`Notifications cannot be traversed via ${model}.${field} — query them top-level`);
    }
    if (target === "Comment" && ctx.role === "CLIENT_VIEWER") {
      throw new TenancyViolationError(`Client Viewers cannot traverse ${model}.${field} — query comments top-level`);
    }
    if (value !== null && typeof value === "object") {
      assertRestrictedRelations(target, value as Record<string, unknown>, ctx);
    }
  };
  const include = node.include as Record<string, unknown> | undefined;
  for (const [field, value] of Object.entries(include ?? {})) {
    if (value === false) continue;
    check(field, value);
  }
  const select = node.select as Record<string, unknown> | undefined;
  for (const [field, value] of Object.entries(select ?? {})) {
    if (field === "_count") continue;
    if (value !== null && typeof value === "object") check(field, value);
  }
}

/**
 * Validate and rewrite Prisma args so every operation is confined to
 * ctx.engagementId (and, for Client Respondents, to their assigned
 * applications). Throws TenancyViolationError on anything suspicious.
 */
export function guardArgs(model: string, operation: string, rawArgs: unknown, ctx: GuardContext): Record<string, unknown> {
  if (DENIED_MODELS.has(model)) {
    throw new TenancyViolationError(`Model ${model} is not accessible through the scoped client`);
  }

  const isRead = READ_OPS.has(operation);
  const isWrite = WRITE_OPS.has(operation);
  if (!isRead && !isWrite) {
    // Default-deny: raw ops, fieldRef tricks, or future Prisma operations must
    // be reviewed and added explicitly before they pass.
    throw new TenancyViolationError(`Operation ${operation} is not allowed through the scoped client`);
  }

  if (isWrite) {
    if (APPEND_ONLY_MODELS.has(model) && operation !== "create" && operation !== "createMany") {
      throw new TenancyViolationError(`${model} is append-only`);
    }
    if (ctx.readOnly) {
      throw new TenancyViolationError("This engagement is archived — it is read-only");
    }
    if (ctx.role === "CLIENT_VIEWER") {
      throw new TenancyViolationError("Client Viewers have read-only access");
    }
  }

  if (ctx.role === "CLIENT_RESPONDENT") {
    // Respondents' own actions are audited: APPEND allowed, reads stay denied.
    const isAuditAppend = model === "AuditEvent" && operation === "create";
    if (!isAuditAppend) {
      if (!RESPONDENT_READ_MODELS.has(model)) {
        throw new TenancyViolationError(`Client Respondents cannot access ${model}`);
      }
      if (isWrite && !RESPONDENT_WRITE_OPS[model]?.has(operation)) {
        throw new TenancyViolationError(`Client Respondents cannot ${operation} ${model}`);
      }
    }
    // Relations reached via include/select are not predicate-scoped — re-check
    // that each targets a readable model (security review F2).
    assertRespondentRelations(model, rawArgs as Record<string, unknown> | undefined);
  }
  assertRestrictedRelations(model, rawArgs as Record<string, unknown> | undefined, ctx);

  const args: Record<string, unknown> = structuredClone(rawArgs ?? {}) as Record<string, unknown>;
  assertNoForeignEngagement(args, ctx.engagementId, "args");

  const scope: Record<string, unknown> = { engagementId: ctx.engagementId };
  let predicate = ctx.role === "CLIENT_RESPONDENT" ? respondentPredicate(model, ctx.membershipId) : null;
  // Row-level collaboration rules (injected into WHERE, never into creates):
  // notifications are personal — every role sees only its own; Client Viewers
  // see only shared (internal:false) comments.
  if (model === "Notification") {
    predicate = { ...(predicate ?? {}), recipientMembershipId: ctx.membershipId };
  }
  if (model === "Comment" && ctx.role === "CLIENT_VIEWER") {
    predicate = { ...(predicate ?? {}), internal: false };
  }

  // Inject the tenancy scope (and respondent predicate) into the where clause.
  if (UNIQUE_WHERE_OPS.has(operation)) {
    // Unique selectors: engagementId spreads in as a sibling filter
    // (Prisma 5+ WhereUniqueInput accepts non-unique filter fields).
    args.where = { ...(args.where as Record<string, unknown>), ...scope, ...(predicate ?? {}) };
  } else if (operation !== "create" && operation !== "createMany" && operation !== "createManyAndReturn") {
    args.where = withScope(args.where, predicate ? { ...scope, ...predicate } : scope);
  }

  // Stamp engagementId onto created rows.
  if (operation === "create") {
    args.data = { ...(args.data as Record<string, unknown>), engagementId: ctx.engagementId };
  } else if (operation === "createMany" || operation === "createManyAndReturn") {
    const data = args.data;
    args.data = Array.isArray(data)
      ? data.map((row) => ({ ...(row as Record<string, unknown>), engagementId: ctx.engagementId }))
      : { ...(data as Record<string, unknown>), engagementId: ctx.engagementId };
  } else if (operation === "upsert") {
    args.create = { ...(args.create as Record<string, unknown>), engagementId: ctx.engagementId };
  }

  return args;
}
