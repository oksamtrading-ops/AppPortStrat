# Application Portfolio Strategy Platform — Product Specification v1.0

**Prepared for:** Deloitte Enterprise Architecture practice
**Date:** 2026-07-17
**Companion documents:** `workbook-logic-inventory.md` (verified source of truth for all methodology logic), `CLAUDE.md` (build brief for the implementation agent)

---

## 1. Executive summary

The APS Excel tool (v5.0, 2016) encodes a proven application rationalization methodology — weighted IT/Business scoring, 4R dispositions, capability heat maps, TCO analysis — but its delivery vehicle limits the practice: single-user, fragile VBA, no client self-service, no engagement reuse, and 19 documented defects. We are rebuilding it as a multi-engagement web platform. The methodology is replicated exactly (every formula, weight mechanism, and threshold verified against the workbook); the delivery experience is redesigned around guided surveys, live dashboards, and client-ready exports.

**V1 scope (all confirmed must-have):** full analysis core (inventory, four surveys, weighted scoring, 4R disposition engine, dashboards, 4R scatter), capability mapping with heat maps, financial/TCO analysis, and executive reporting exports (PPTX/XLSX/PDF).

**Delivery model:** one platform, many engagements. Each engagement is an isolated workspace; Deloitte consultants and client users authenticate via Clerk with role-scoped access.

---

## 2. Users and roles

| Role | Who | Can |
|---|---|---|
| Platform Admin | Practice tooling owner | Create engagements, manage all users, platform settings |
| Engagement Lead | Deloitte partner/manager | Everything within their engagement(s): configure weightings/thresholds, manage members, override dispositions, export |
| Consultant | Deloitte practitioner | Enter/edit all data, run analysis, export; cannot change engagement membership |
| Client Respondent | Client app owner / SME | Complete surveys only for applications assigned to them; sees nothing else |
| Client Viewer | Client executive stakeholder | Read-only dashboards, heat maps, and reports for their engagement |

Clerk Organizations map 1:1 to engagements. A user may belong to multiple engagements with different roles (a consultant on two projects; never a client). Client Respondents are invited by email per engagement and scoped to assigned applications.

## 3. Tenancy and isolation

- One deployment, one database; every row carries `engagement_id`; all queries filtered at the data-access layer (enforced centrally, not per-query-site).
- Client users can never enumerate, query, or infer other engagements. Engagement switcher visible only to multi-engagement Deloitte users.
- Engagement lifecycle: Active → Archived (read-only) → Purged (hard delete on client data-retention request). Every engagement's full dataset exportable to Excel at any time (exit path — no lock-in vs. the old workbook).

---

## 4. Functional requirements

### 4.1 Engagement setup
- Create engagement: name, client, status, currency, fiscal year convention.
- Seed options: start empty, clone configuration (weightings, thresholds, capability model, option lists — never data) from a template or prior engagement.
- Configurable option lists per engagement (application types, action-plan categories, etc.), pre-seeded with the workbook defaults in inventory §2.5. The client-specific legacy list `lkup_ActionPlanAssignment` ships as an editable example, not a default.

### 4.2 Application inventory (replaces Master Data View)
- CRUD for applications: name, acronym, description, type, L0/L1/L2 capability (cascading selects from the engagement's capability model), business function detail, target, meets-future-state (Y/N/Partial), action plan assignment + justification, mission-critical (Y/N), comments.
- Scope flags per application: In Scope, Is Utilized, Is Replaced, In Flight (Y/N each) — the inputs to the filter cascade (§4.8).
- Master grid view = the new MDV: sortable, filterable, column-configurable table of every application with scores, disposition, survey completion, and filter status. Column statistics (min/max/mean/median/mode/count) computed live on the filtered set — replacing the VBA `RefreshStatistics_MDV` button.
- No row limits (workbook capacity was 1,002 with hard-coded ranges; inventory quirk #12).

### 4.3 Capability model
- Per-engagement L0 → L1 → L2 hierarchy, editable in a tree/table UI; bulk paste/import from Excel (denormalized 3-column format, matching `tab_Capability_Map`).
- Blank L0/L1 handling: auto-derive placeholder parents exactly as VBA `add_Capability` did ("Level L0"/"Level L1") but surface them as explicit "Unassigned" nodes the user is prompted to resolve.
- Deduplication automatic and continuous — no "refresh capability map" button.

### 4.4 Surveys
Four survey types per application, replicated from the workbook (full question sets, section structure, guideline texts 1–5, and validation lists in inventory §2.2):

1. **Demographics** — 119 fields in 7 sections (General, Business Units, Application Information, Hardware, Database, Middleware, Systems Supported, Comments). Not scored.
2. **IT Health** — 24 weighted questions (Technical Competence 14, Architecture/Infrastructure 3, Technical Risk 7) + 4 non-report questions (kept as informational attributes with their own local score, per quirk #9 recommendation).
3. **Business Value** — 11 weighted questions (Strategic Importance 5, Operations 6).
4. **Finance** — TCO line items: Hardware/Infrastructure (6), App Maintenance (5), App Development (5), Commercial Software (4), plus past/future costs, budget, revenue.

UX (the "improve UX" mandate):
- One guided form per application per survey — the workbook's transposed 1,000-column sheets disappear entirely.
- Each scored question shows its 1–5 guideline anchors inline (the workbook's C–G columns become the answer labels).
- Answer options: 1–5 **plus explicit N/A** (resolving quirk #2 — the workbook's correction factor was designed for N/A answers the dropdown never offered).
- Autosave, per-section progress, survey status (Not started / In progress / Complete — replacing the mis-validated "Status" row, quirk #6).
- Assignment: consultants assign surveys to Client Respondents per application; respondents get an email invite and see only their queue. Consultants can always fill on the client's behalf (workshop mode).
- Completion % per survey per app, computed as in the workbook (answered ÷ applicable questions) but without the Demographics 2%-floor hack (quirk #16).

### 4.5 Weightings configuration (replaces Weightings Control Panel)
- Per engagement, per question: Importance rating on the workbook's scale (N/A=0, Less important=1, Normal=2, Somewhat important=3, Important=4, Very important=5).
- Weight = rating ÷ sum of ratings within the score family (Business, IT) — normalized to 1.0, exactly as the workbook. Displayed live as the user adjusts.
- Editable only by Engagement Lead; changes re-score the portfolio immediately and are recorded in the audit log (weights are engagement-level analytical decisions).
- Ships with the tool-neutral default (all questions "Normal") and an optional "APS 5.0 sample config" preset (BV: 2 × 0.5; IT: 10 × 0.1 — the project-specific setting found in this copy, inventory §3.1).

### 4.6 Scoring engine — exact replication
Implemented server-side, unit-tested against golden values (see CLAUDE.md):

- **Score = Σ(weightᵢ × answerᵢ) × correctionFactor**, per family (IT over its 24 questions, Business over its 11).
- **correctionFactor = max(1 ÷ Σ(weights of questions answered ≠ N/A), 1)** — re-normalizes when questions are answered N/A.
- **Departure from workbook (deliberate, flagged):** unanswered questions are treated as N/A (excluded and renormalized) rather than scoring 0 while still counting in the denominator. The workbook's behavior silently deflates partially-surveyed apps (quirk #3). The app instead renormalizes and displays a completeness warning on any score computed from a partial survey. A per-engagement setting `strictWorkbookScoring` restores the legacy behavior for continuity if a team requires it.
- Scores are 0–5, displayed to 1 decimal. Score = 0 (nothing answered) → disposition "Unknown".
- **Financial Score** = app grand total ÷ max grand total across in-scope apps (0–1 relative cost index), with subtotals actually computed (fixing quirk #1 — the workbook's subtotal formulas are missing, so its grand totals were always 0).

### 4.7 Disposition engine (4R)
- Thresholds per engagement: Optimum BV (default 3.0), Optimum IT (3.0), Urgent BV (2.0), Urgent IT (2.0); editable 0–5 in 0.1 steps.
- Mapping, exactly as verified (boundary semantics `>=` preserved — a score equal to the threshold is "high", quirk #4):

| Condition | Disposition |
|---|---|
| BV = 0 or IT = 0 | Unknown |
| BV < Opt-BV and IT ≥ Opt-IT | Re-Design |
| BV ≥ Opt-BV and IT ≥ Opt-IT | Keep-As-Is |
| BV < Opt-BV and IT < Opt-IT | Terminate |
| BV ≥ Opt-BV and IT < Opt-IT | Re-Tool |

- Industry synonyms shown alongside (Keep-As-Is/Retain, Re-Tool/Replace, Re-Design/Replace, Terminate/Retire) — one canonical vocabulary in data, display labels configurable (resolving quirk #10's naming drift).
- **Manual override:** Engagement Lead may override the computed disposition per application (choosing from the four 4R values) with a required justification; both computed and final values are stored and shown. This implements the workbook's abandoned "Deloitte Override" intent (quirk #8) and collapses the duplicated Final Disposition / Disposition Status columns into computed + override.
- Urgent thresholds drive "very low BV/IT" alert counts and flags only — never a fifth disposition (quirk #7).
- Threshold changes recompute the portfolio live (the spin-button experience, without VBA).

### 4.8 Scoping and filtering
Filter status per application, first match wins (verified cascade, inventory §5): Not In Scope → No Longer Utilized (in scope, not utilized) → Terminate (disposition) → Replaced → In Flight → else disposition pass-through. **Analysis Candidate = yes** only when no filter hits. Summary counts by filter status on the dashboard. Flags editable inline in the inventory grid (no separate control-panel screen needed).

### 4.9 Heat map
- Matrix: columns = L1 capabilities, cells = L2 capabilities, colored by aggregated disposition of mapped, known-disposition applications.
- Rules (verified, §6): per L1+L2 cell with n apps — red "Terminate" if terminateCount/n > T₁ (default 10%); yellow "Re-Tool/Re-Design" if (retoolCount+redesignCount)/n > T₂−T₁ (default 26%−10% = 16%); else green "Retain". Colors: #CC0000 / #FFFF00 / #00B050 (the workbook's exact RGBs). We simplify the ROUNDUP(x,1) artifact to a plain strict fraction comparison (quirk #11) — same outcomes at whole-app counts.
- Thresholds editable per engagement with the workbook's validation (T₂ must exceed T₁; retain % = 1−T₂).
- Live — no generate/clear buttons. Cell click drills through to the app list behind it.
- Yellow bucket merges Re-Tool + Re-Design as the workbook did; a toggle can split them into two colors (practice-requested improvement, off by default for fidelity).

### 4.10 Dashboard
Replicates the workbook dashboard KPIs (verified formulas, §8), live:
- 2×2 disposition matrix counts and disposition breakdown (Unknown, Out of Scope, No Longer Utilized, Terminate candidates, Re-Tool, Re-Design, Keep-As-Is).
- Mission-critical split (fixing the Y/"<>Y" vocabulary mismatch by standardizing all yes/no fields to a single boolean presentation, quirk #5).
- Application universe (in/out of scope), collection progress per survey (Complete/Partial/Missing — with the IT-column copy-paste bug fixed, quirk #19), score distribution buckets 0–1…4–5 for BV and IT.
- **4R scatter:** X = Business Score, Y = IT Score (the chart-sheet convention, quirk #18 resolved), threshold cross-hairs at the optimum values, points colored by disposition, hover = app details, click-through to the app. Quadrant labels rendered in-chart.
- Mission-critical application list (replacing the broken VBA refresh).

### 4.11 Financial analysis
- Per-app TCO summary from the Finance survey with computed subtotals and grand total; portfolio views: cost by disposition (the analysis the workbook implied but never wired — cost of the Terminate bucket = savings candidate), cost by capability, cost by version (Actual/Budget/Forecast).
- Fiscal-year cost dataset import (the Financial Data sheet's role): flat table upload keyed by application and version; pivot-style summaries replace the PIVOT sheet.
- Costs remain context — never an input to disposition (faithful to the workbook).

### 4.12 Excel import/export
- **Import:** bulk application inventory (CSV/XLSX column mapping wizard), capability model, fiscal cost data, and — critically — survey responses from the original APS workbook format, so in-flight engagements can migrate.
- **Export:** full engagement workbook (inventory + surveys + scores + dispositions) to XLSX in a layout consultants recognize; any grid exports to CSV/XLSX.

### 4.13 Executive reporting exports
- **PPTX:** engagement summary deck — portfolio overview, 4R scatter, disposition breakdown, heat map, top Terminate/Re-Tool candidates with rationale, TCO summary. Deloitte-branded template.
- **PDF:** dashboard snapshot and per-application one-pagers (profile, scores, disposition, rationale, costs).
- **XLSX:** as §4.12.

### 4.14 Audit and change log
- Automatic, append-only audit log per engagement: who changed what, when (weightings, thresholds, overrides, scope flags, survey answers). Replaces the manual Change Log sheet, which VBA never wrote to.
- Data-quality panel: unscored in-scope apps, partial surveys, apps with no capability mapping, orphan capabilities — surfacing the states the workbook hid.

---

## 5. Methodology fidelity decisions

Every workbook quirk (inventory §11) is resolved; the disposition of each:

| # | Quirk | Decision |
|---|---|---|
| 1 | Finance subtotals missing | Fix — compute subtotals |
| 2 | No N/A answer option | Fix — add N/A, matching correction-factor design intent |
| 3 | Blanks deflate scores | Change with escape hatch — renormalize + warn; `strictWorkbookScoring` setting restores legacy |
| 4 | `>=` threshold boundaries | Preserve exactly |
| 5 | Y/N vs Yes/No mismatch | Fix — booleans everywhere |
| 6 | Status rows validated against disposition list | Fix — proper survey status enum |
| 7 | Urgent thresholds | Preserve as alert counts only |
| 8 | Disposition override remnants | Implement properly: computed + justified manual override |
| 9 | Non-report IT questions | Keep as informational attributes + local score |
| 10 | Naming drift (Retain/Keep-As-Is etc.) | One canonical enum, configurable display labels |
| 11 | ROUNDUP(x,1) heat map artifact | Simplify to strict fraction comparison (equivalent at integer counts) |
| 12 | Hard-coded range extents | N/A — unbounded collections |
| 13 | ~145 broken named ranges, dead subsystems | Excluded; DDOR/ranking subsystem not rebuilt |
| 14 | Vendor Support Platform→Database range bug | N/A in new model; correct field mapping in importer |
| 15 | Stray comma in weight formulas | N/A |
| 16 | Demographics 2% completion floor | Dropped — real status tracking replaces the hack |
| 17 | PIVOT capacity mismatch | N/A — proper aggregation |
| 18 | Scatter axis inconsistency | X = Business Value, Y = IT Health, everywhere |
| 19 | Dashboard IT-completion COUNTIFS bug | Fixed |

---

## 6. Architecture

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js (App Router, TypeScript) | Single codebase, server components for data-heavy grids, API routes for the scoring engine |
| Auth | Clerk (Organizations = engagements) | Confirmed choice; invitations, MFA, org roles out of the box |
| Database | PostgreSQL + Prisma | Relational model fits inventory/survey/scoring; row-level `engagement_id` scoping in a central data-access layer |
| UI | Tailwind + shadcn/ui | Deloitte theme (black/white, #86BC25 green accent) as design tokens |
| Charts | Recharts (scatter, bars, pies); custom grid for heat map | |
| Exports | `pptxgenjs` (PPTX), `exceljs` (XLSX), server-rendered PDF | |
| Scoring | Pure TypeScript module, zero I/O, exhaustively unit-tested | The methodology core must be provably correct |
| Hosting | Vercel + Neon/Supabase Postgres for pilot | No constraints given; revisit for Deloitte-managed hosting before client production use |

**Key data entities:** Engagement, User/Membership(role), Application, CapabilityNode(L0/L1/L2), SurveyTemplate/Question/GuidelineAnchor, SurveyResponse/Answer, WeightingConfig, ThresholdConfig, DispositionResult(computed, override, justification), CostRecord(fiscal), OptionList, AuditEvent.

**Non-functional:** all queries engagement-scoped by construction; portfolio recompute (1,000+ apps) < 1s; audit log append-only; survey autosave; WCAG AA on client-facing screens.

---

## 7. Delivery phases (for the Claude Code build)

1. **Foundation** — Auth (Clerk orgs), engagement workspaces, roles, data layer with tenancy enforcement, app shell + Deloitte theme.
2. **Methodology core** — Scoring + disposition + filter engines as pure modules with golden tests from the inventory; weightings & thresholds config UI.
3. **Inventory & surveys** — Application CRUD + master grid; four survey forms with question banks seeded from the inventory; assignment + client respondent flow.
4. **Analysis** — Dashboard, 4R scatter, capability model + heat map, financial views.
5. **In/out** — Excel import (incl. legacy APS workbook migration), XLSX/PPTX/PDF exports, audit log, data-quality panel.

Each phase ends demoable. Golden-test pass on phase 2 is the gate for everything downstream.

---

## 8. Open items (Albert to confirm, none blocking phases 1–3)

1. Default weighting preset per new engagement: tool-neutral (all "Normal") or the APS 5.0 sample config?
2. Deloitte-managed hosting/SSO target for production (pilot proceeds on Vercel).
3. PPTX export template: existing practice deck to match, or design fresh from brand guidelines?
4. Should Client Viewers see costs? (Default: yes within their engagement.)
