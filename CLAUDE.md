# CLAUDE.md — APS Platform Build Brief

You are building the **Application Portfolio Strategy (APS) Platform**: a multi-engagement web application that replaces Deloitte's `excelapp.xlsm` application rationalization tool.

## Read these first, in order
1. `APP-SPEC.md` — the product spec. It is the requirements contract.
2. `workbook-logic-inventory.md` — the verified extraction of the Excel tool's logic. **This is the source of truth for every formula, weight mechanism, threshold, question text, option list, and validation rule.** It was independently verified against the workbook (see its Verification Log). Do not re-derive logic from `excelapp.xlsm` yourself; do not invent methodology.

## Non-negotiables
- **Methodology fidelity.** Scoring (inventory §3), disposition (§4), filtering (§5), and heat map rules (§6) must match the documented formulas exactly, including `>=` boundary semantics. The only sanctioned deviations are the 19 quirk resolutions in APP-SPEC.md §5 — implement those as specified (note the `strictWorkbookScoring` engagement setting for quirk #3).
- **Tenancy.** Every domain table has `engagement_id`. Enforce scoping in one central data-access layer; no query may bypass it. Client Respondents see only their assigned applications' surveys; Client Viewers are read-only.
- **The methodology core is pure.** Scoring/disposition/filter/heat-map engines are pure TypeScript functions (no I/O, no framework imports) in their own package/module, so they are testable in isolation.

## Stack (decided — do not substitute)
Next.js (App Router, TypeScript) · Clerk with Organizations (org = engagement; roles per APP-SPEC §2) · PostgreSQL + Prisma · Tailwind + shadcn/ui · Recharts · pptxgenjs / exceljs / server PDF. Deloitte theme: white/black UI, `#86BC25` accent, professional density.

## Build order
Follow the five phases in APP-SPEC §7. Phase 2 (methodology core + golden tests) gates everything after it. Seed the survey question banks — all question texts, sections, and 1–5 guideline anchors — from inventory §2.2, and the option lists from §2.5, as a Prisma seed script.

## Golden tests (write these before the engines; all must pass)

Scoring (per inventory §3.2):
1. 10 IT questions weighted 0.1 each, all answered 5 → IT score = 5.0.
2. Same weights, answers = [5,5,5,5,5,4,4,4,3,3] → 4.3.
3. Two BV questions at 0.5 each, answers 4 and 2 → 3.0.
4. Weights 0.5/0.3/0.2, middle question answered N/A → correctionFactor = 1/(0.5+0.2) = 1.4286; answers 4 and 3 → (0.5·4 + 0.2·3) × 1.4286 = 3.714….
5. correctionFactor never < 1: all questions answered → factor = 1.
6. Nothing answered → score 0 → disposition "Unknown".
7. Weight derivation: ratings [Very important, Very important, N/A, …] → weights [0.5, 0.5, 0, …]; weights always sum to 1 within a family (unless all N/A → all 0).
8. `strictWorkbookScoring = true`: unanswered questions contribute 0 and remain in the denominator (legacy deflation); `false` (default): unanswered treated as N/A with renormalization + partial-survey flag.

Disposition (thresholds Opt-BV = Opt-IT = 3.0):
9. BV 2.9, IT 3.0 → Re-Design. 10. BV 3.0, IT 3.0 → Keep-As-Is. 11. BV 2.9, IT 2.9 → Terminate. 12. BV 3.0, IT 2.9 → Re-Tool. 13. BV 0 or IT 0 → Unknown, regardless of the other. 14. Manual override stores both computed and final values and requires a justification string.

Filter cascade (inventory §5, first match wins):
15. inScope=N → "Out of Scope" even if disposition = Terminate. 16. inScope=Y, isUtilized=N → "No Longer Utilized". 17. in scope, utilized, disposition Terminate → "Terminate" even if isReplaced=Y. 18. in scope, utilized, non-Terminate, isReplaced=Y → "Replaced". 19. …isReplaced=N, inFlight=Y → "In Flight". 20. no filter hits → status = disposition, analysisCandidate = true; any hit → false.

Heat map (T₁ = 0.10, T₂ = 0.26):
21. Cell with 10 apps, 2 Terminate → red (0.2 > 0.1). 22. 10 apps, 1 Terminate → not red (0.1 ≯ 0.1, strict). 23. 10 apps, 0 Terminate, 2 Re-Tool/Re-Design → yellow (0.2 > 0.16). 24. 10 apps, 1 Terminate, 1 Re-Tool → green (neither strict threshold exceeded). 25. 0 known-disposition apps → uncolored. Colors exactly #CC0000/#FFFF00/#00B050. Config validation: reject T₂ ≤ T₁.

Tenancy:
26. A query for engagement A's applications from a user with membership only in B returns nothing (and is rejected at the access layer, not just filtered client-side).

## Conventions
- Disposition enum: `UNKNOWN | REDESIGN | KEEP_AS_IS | TERMINATE | RETOOL` — canonical in data; display labels (incl. Retain/Replace/Retire synonyms) via a label map.
- All yes/no fields are booleans in the schema; render as Yes/No.
- Scores stored as numeric, displayed to 1 decimal, 0–5 domain.
- Recompute scores/dispositions transactionally whenever answers, weightings, or thresholds change; portfolio recompute for 1,000 apps must complete < 1s (compute in the pure engine over an in-memory snapshot, then bulk-write).
- Audit every mutation of: weightings, thresholds, overrides, scope flags, survey answers (append-only `AuditEvent`).
- Never hard-code capacity limits (the workbook's row-limit failure mode, inventory quirk #12).

## Legacy migration
The XLSX importer must accept the original APS v5.0 workbook layout: MDV rows → applications; survey tabs are transposed (apps in columns, questions in rows — mapping documented in inventory §2.2); Weightings CP col K → importance ratings; DCP E7:H7 → thresholds; Capability Map A8:C → capability model. Beware inventory quirk #14 (the workbook's Platform named range actually points at the Database column — map by header text, not by named range).

## Out of scope — do not build
The DDOR/ranking subsystem (List R1, rank ranges, RTO bands — deprecated in APS 5.0), bubble charts, and anything referencing the ~145 broken named ranges (inventory §10, quirk #13).
