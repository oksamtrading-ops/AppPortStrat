# Multi-Respondent Surveys — Design (v1, awaiting approval)

_Status: DESIGN ONLY — no code yet. Implementation starts after Albert approves §12._
_Deliberately extends beyond the source workbook (one answer column per app per survey);
approved by Albert 2026-07-22._

## 1. Goal

Multiple respondents can answer the **same survey for the same application**
independently. The system aggregates their answers (average) into the working
score; a Lead/Consultant-authored **consensus** (workshop) layer overrides the
average per question. A report shows every respondent's answers side by side.

**Non-goals:** weighting respondents differently; anonymous responses;
changing the scoring methodology downstream of the per-question value
(weights, thresholds, dispositions, golden tests all unchanged).

## 2. Approved decisions (from discussion)

| # | Decision |
|---|---|
| D1 | Two layers: per-respondent responses + one optional consensus response |
| D2 | Final value per question = `consensus ?? aggregate(respondents)` — the consensus **replaces**, is never averaged in |
| D3 | The average is computed from **respondent answers only** |
| D4 | **Finalization locks respondent input** — enforced server-side, not process. Lead **Reopen** unlocks (existing UX). No "late input" flagging machinery — post-finalization input cannot exist |
| D5 | Existing data migrates **by authorship**: responses last edited by Lead/Consultant → consensus layer; by a respondent → that respondent's layer |

## 3. Conceptual model

```
SurveyResponse (app × template × layer)
├── kind=RESPONDENT, respondentMembershipId=M1   ← respondent M1's answers
├── kind=RESPONDENT, respondentMembershipId=M2   ← respondent M2's answers
└── kind=CONSENSUS,  respondentMembershipId=null ← workshop/lead layer (0..1)

final(question) = consensusAnswer(question)
               ?? aggregate(respondentAnswers(question))   // §5 rules
```

The idiom mirrors `finalDisposition = override ?? computed` — precedence, not
blending — applied at the answer level.

## 4. Data model changes

### 4.1 Schema (hand-written migration; never `prisma migrate dev`)

`SurveyResponse` gains:

```prisma
kind                   ResponseKind @default(CONSENSUS)  // CONSENSUS | RESPONDENT
respondentMembershipId String?                            // set iff kind=RESPONDENT
finalizedAt            DateTime?                          // consensus row only; the lock
respondent             Membership? @relation(fields: [respondentMembershipId, engagementId], references: [id, engagementId], onDelete: Cascade)
```

Uniqueness (partial indexes, in the migration SQL — Prisma can't express them):

```sql
-- one consensus row per app+survey
CREATE UNIQUE INDEX "SurveyResponse_consensus_key"
  ON "SurveyResponse"("applicationId", "templateId") WHERE "kind" = 'CONSENSUS';
-- one row per respondent per app+survey
CREATE UNIQUE INDEX "SurveyResponse_respondent_key"
  ON "SurveyResponse"("applicationId", "templateId", "respondentMembershipId") WHERE "kind" = 'RESPONDENT';
-- kind/respondent coherence (same pattern as Comment_target_xor)
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_kind_respondent_check"
  CHECK (("kind" = 'RESPONDENT') = ("respondentMembershipId" IS NOT NULL));
```

The existing `@@unique([applicationId, templateId])` is **dropped** (replaced
by the two partial indexes). `Answer` gains `updatedAt DateTime @updatedAt`
(needed for §5 latest-wins and the report). No new tables → `hardening.sql`
RLS arrays unchanged (drift test confirms).

### 4.2 Migration of existing rows (shared prod DB — apply to Neon BEFORE push)

1. Add columns with defaults (`kind=CONSENSUS` matches today's semantics: one
   canonical shared response).
2. Reclassify by authorship (D5): rows whose `updatedById` is a
   CLIENT_RESPONDENT membership → `kind=RESPONDENT`,
   `respondentMembershipId=updatedById`. All others (lead/consultant/null) stay
   CONSENSUS.
3. Existing `COMPLETE` consensus rows get `finalizedAt = updatedAt` (they were
   "done" under the old model; keeps them locked, Reopen available).
4. Verify with counts + `to_regclass`-style checks before `migrate resolve`.

Scores cannot change from migration alone: each app+survey still has exactly
one response, and `consensus ?? aggregate(one respondent)` = that same answer set.

## 5. Aggregation rules (per question)

Consensus answer always wins when present (including consensus N/A). Otherwise:

| answerKind | Aggregate of respondent answers |
|---|---|
| `SCORE_1_5` | **Mean** of numeric answers, N/A and missing excluded. All-answers-N/A → N/A. No numeric answers → unanswered. The mean is a float (e.g. 3.5) — downstream already handles floats (family scores are averages today) |
| `NUMBER`, `CURRENCY` | **Latest updated wins** (facts, not opinions — averaging two people's "Mainframe cost" is wrong; Finance feeds financialScore/TCO). Report shows all values so divergence is visible |
| `TEXT`, `DATE`, `BOOLEAN`, `OPTION` | **Latest updated wins**, same rationale |

All four templates get the same data model (uniform per-respondent responses);
only the aggregate function differs by kind. For Demographics/Finance,
latest-wins is exactly today's shared-doc behavior, now with per-respondent
attribution — strictly better.

Implementation point: `recompute.ts` already flattens answers to one value per
(app, question) before the scorer runs. The aggregation is a pure pre-step
there (new `src/lib/methodology/aggregate.ts`, unit-tested). The scorer and
**all golden tests run unchanged** on the aggregated input.

## 6. Finalization & locking (D4)

- New Lead/Consultant action **Finalize** on an app+survey: upserts the
  consensus row (even with zero answers — it's the lock anchor), sets
  `finalizedAt`, status `COMPLETE`.
- While `finalizedAt` is set: every respondent write to that app+survey is
  **rejected in the action layer** with a clear message ("finalized — ask the
  engagement lead to reopen"). UI shows the survey read-only with a banner.
- **Reopen** (existing button, now clears `finalizedAt`) re-admits respondent
  edits. Both actions audited (`survey.finalize` / `survey.reopen`).
- Per-respondent auto-complete (the 9690079 feature) continues to operate on
  each respondent's own response status; it never locks anyone else.
- Recording consensus answers *without* finalizing is allowed (scenario: lead
  pins 3 contested questions mid-collection; respondents keep answering the
  rest). Only Finalize locks.

## 7. Access control (guard + actions)

- **Respondents:** own-row predicate on `SurveyResponse` (kind=RESPONDENT ∧
  respondentMembershipId = own membership) injected in the guard — same
  mechanism as the Notification own-recipient rule — plus traversal re-check
  via RELATION_MAP. Answers are reached only through their own response.
  Respondents never see other respondents' answers, the average, or the
  consensus values beyond what today's assignment flow shows them.
- **Lead/Consultant:** read all layers; write consensus; Finalize/Reopen.
- **Client Viewer:** sees final (aggregated) values only — no per-respondent
  breakdown (individual client staff answers are sensitive).
- RLS stays tenant-level (unchanged); per-respondent rules are guard-level,
  consistent with the existing row-rule architecture.

## 8. Completion semantics & affected surfaces

Survey-level display status per app+template becomes derived:
`finalized → Complete; else best-of respondent statuses (any IN_PROGRESS →
Partial; all assigned COMPLETE → Complete; none started → Missing)`.

Surfaces to update (inventory — each currently assumes one response per
app+template):

| Surface | Change |
|---|---|
| `computeSurveyCompletion` (admin.ts) | takes a response-set; respondent sees own completion, lead sees derived |
| Dashboard "Data confidence" + drill-down (Surveys `?template=&status=`) | derived status; per-respondent coverage line ("2 of 3 respondents complete") |
| Survey form page | respondents load own response; lead gets layer switcher: Consensus / respondent tabs / Average (read-only) |
| Applications grid response-status pills | derived status |
| `landscape.ts` completion bundle (AI) | derived status |
| Legacy `.xlsm` import | imports as **consensus** (the workbook is a settled canonical record) |
| `generate-sample-workbook.ts` self-test | consensus path — unchanged behavior |
| `quality.ts` straight-lining copilot | reads per-respondent responses (better signal than the merged doc) |

## 9. Respondent report

New Lead/Consultant-only page, per application+survey (linked from the survey
form and the report of the assignment list):

- Rows = questions (grouped by section); columns = each respondent (name,
  status, updatedAt) · **Average** · **Consensus** · **Final**.
- Divergence highlighting: score questions where max−min ≥ 2, or where
  consensus differs from the average.
- Export: CSV (existing formula-injection-escaped export path).
- Guard-enforced Lead/Consultant only (viewer/respondent get 404), audited view.

## 10. Testing & verification

- New unit tests: `aggregate.ts` (mean/N-A/latest-wins/empty), finalization
  lock (action rejects), migration reclassification logic.
- New tenancy tests: respondent A cannot read/write respondent B's response or
  the consensus (incl. include/select traversal); viewer cannot reach
  per-respondent rows.
- Golden methodology tests: **must pass unchanged** — the fidelity contract.
- Browser verification on dev-auth (:3001): two respondents answer the same
  IT survey → average appears; lead pins one question + finalizes → respondent
  edit rejected; Reopen → edit works; report renders all columns.

## 11. Rollout sequence (one commit per step, Neon migration before push)

1. Schema migration + backfill/reclassify + verify script (no behavior change).
2. `aggregate.ts` + recompute pre-step + tests (single-respondent output
   provably identical → scores stable).
3. Guard own-row rules + tenancy tests.
4. Survey actions/pages: per-respondent responses, consensus editing,
   Finalize/Reopen + lock.
5. Derived completion across surfaces (§8 table).
6. Respondent report page.
7. Full browser verification + memory/handover update.

## 12. Sign-offs required from Albert before implementation

| # | Decision taken in this doc | My call |
|---|---|---|
| S1 | All four survey templates get per-respondent responses (uniform model), with **latest-wins** (not averaging) for facts — TEXT/NUMBER/CURRENCY/etc. Only SCORE_1_5 averages | Recommended — averaging costs/facts is wrong; uniform model keeps one mental model |
| S2 | Finalize is an **explicit action** (not implied by recording consensus answers), so a lead can pin individual questions mid-collection without locking everyone out | Recommended |
| S3 | Client Viewers see final values only, never the per-respondent breakdown | Recommended — client-staff answers are sensitive |
| S4 | Legacy workbook imports land as consensus | Recommended — the workbook is a settled record |
