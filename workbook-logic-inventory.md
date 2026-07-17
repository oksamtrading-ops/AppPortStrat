# Deloitte Application Portfolio Strategy (APS) Tool v5.0 — Complete Workbook Logic Inventory

Source: `excelapp.xlsm` (Excel macro-enabled workbook, 3.5 MB). Extracted 2026-07-17 with openpyxl + oletools/olevba.
This document is the source of truth for rebuilding the tool as a web application. Client data values are NOT copied; only structure, formulas, weights, thresholds, options and row/column counts are documented.

---

## 1. Tool Overview & Data Flow

Stated purpose (Cover tab): collect an application inventory, run IT/Business surveys, score each application, assign a 4R disposition, map applications to business capabilities, generate capability heat maps, and do basic financial (TCO) analysis.

**Sheets (21):**

| Sheet | Role | Visibility |
|---|---|---|
| Cover | Title, purpose, hyperlink menu to all tabs | visible |
| Dashboard | Executive KPIs: 2x2 matrix counts, disposition pie, mission-critical pie, collection progress | visible |
| 4R Framework | Scatter chart: Business Score (X) vs IT Score (Y) with threshold cross-hair lines | visible |
| Capability Map | Entry table for L0/L1/L2 capability model + 3 derived relation tables | visible |
| Demographics | Survey (transposed: questions in rows, apps in columns) — descriptive/technical data | visible |
| IT | Survey — IT Health ratings (1–5) | visible |
| Business | Survey — Business Value ratings (1–5) | visible |
| Finance | Survey — cost line items per app | visible |
| Master Data View (MDV) | One-row-per-application master table; pulls everything back from the surveys | visible |
| Weightings Control Panel | Question importances → normalized weights; score distribution stats | visible |
| Disposition Control Panel (DCP) | Thresholds + 4R disposition computed per app | visible |
| Filtering Control Panel (FCP) | In-scope / utilized / replaced / in-flight flags → filter status & "analysis candidate" | visible |
| Heat Map Data | Per (L1,L2) pair: counts of dispositions → quadrant color decision | visible |
| Heat Map | Rendered capability heat map (VBA paints matrix) + threshold panel | visible |
| Financial Data | Flat cost table (app x fiscal-year version) feeding PIVOT | visible |
| PIVOT | Pivot-table summaries of Financial Data | visible |
| Change Log | Manual log of tool changes (v2.0→v5.0 history) | visible |
| Error Log | Manual error log (3 rows, template) | **hidden** |
| Options | All dropdown lists / config constants | **hidden** |
| Lookup | More dropdown lists incl. the Ratings scale used for weighting | **hidden** |
| List R1 | Legacy ranking report (DDOR ranking, largely deprecated in v5.0) | visible |

**Data flow (circular by design):**

1. Applications are entered as rows on **Master Data View** (App ID, Name, L0/L1/L2 capability, scope flags) — App ID + Name + capabilities are the user-typed "inventory".
2. The survey tabs (**Demographics, IT, Business, Finance**) auto-generate one *column per application*: their header row formulas pull App IDs from MDV via `SMALL('Master Data View'!$A$13:$A$1014, columnOffset)` and App Name via `VLOOKUP(id, tab_MDV, idx_MDV_AppName)`. Users then fill answers *down* the column.
3. **Weightings Control Panel** holds a per-question "Importance" (N/A…Very important → 0…5 via `Ratings2` lookup) which is normalized into a per-question weight. The survey tabs reference these weights and compute a weighted score per app (row 44 on IT, row 28 on Business).
4. **MDV** pulls the per-question answers and the weighted IT/Business scores back via `HLOOKUP(App ID, tab_IT_WeightedScore / tab_BV_WeightedScore / tab_Demographics, idx_*, FALSE)`.
5. **Disposition Control Panel** compares each app's Business Score (G) and IT Score (H) to the four threshold cells E7/F7/G7/H7 and assigns one of the 4Rs; MDV col V reads the disposition back.
6. **Filtering Control Panel** computes filter status / analysis candidacy from S–V flags + disposition; MDV cols P–T read it back.
7. **Heat Map Data** counts dispositions per L1+L2 capability from the DCP helper columns (Q/R/S/T) and decides a Terminate/Redesign/Retain color per L2 cell; VBA macro `generate_Heatmap` paints the **Heat Map** matrix.
8. **Dashboard** and **4R Framework** aggregate MDV/DCP with COUNTIFS and a scatter chart.
9. **Financial Data → PIVOT** is a separate, largely stand-alone TCO analysis path keyed by app number (HLOOKUP into Demographics header for the name).

**Sample data in this copy:** 10 demo applications (App IDs 1–10, e.g. "Liquidity Management", "Encryption Systems"…), retail-style capability model (13 L1 capabilities), FY08 Actual/Budget/Forecast financials (25 app slots x 3 versions = ~75 rows). No scores are filled in (all scores 0 / dispositions "Unknown").

---

## 2. Data Model (Entities / Fields)

### 2.1 Application (Master Data View, rows 13–1014 → capacity 1,002 apps; 10 populated)

Header row = row 12. Statistics band rows 5–10 (`Min, Max, Mean, Median, Mode, Count` — written by VBA `RefreshStatistics_MDV`, not formulas). Row 11 holds integer indexes (11, 12, 13, …) used by the Demographics HLOOKUP offset trick (`c_offset_Demo + <row-11 index>`).

Columns (grouped; **[U]** = user input, **[C]** = calculated):

**Identity & classification**
- A `App ID` [U] — integer key used by every lookup
- B `Application Name` [U], C `Acronym` [U], D `Application Description` [U], E `Application Type` [U], F `Overall Comments` [U]
- G `L0 Capability` [U, dropdown `l0_list_final` = tab_L0_Capability[L0]]
- H `L1 Capability` [U, dependent dropdown `l1_list_final` = INDEX/MATCH slice of tab_L0_L1_Capability_Relation on the row's L0]
- I `L2 Capability` [U, dependent dropdown `l2_list_final` = INDEX/MATCH slice of tab_L1_L2_Relation on the row's L1]
- J `Business Function Detail` [U]
- K `Final Disposition` [C] = `IFERROR(VLOOKUP(A13, tab_DispositionCP, 8, FALSE),"")` (col 8 of DCP table = Disposition)
- L `Target` [U], M `Meets Future State Architecture` [U, dropdown `lkup_MeetsFutureState`: Y / N / Partial]
- N `Action Plan Assignment` [U — Options!AH list], O `Action Plan Justification` [U]

**Scope / filter flags**
- P `In Scope?` [C] = VLOOKUP into FCP col S; Q `Is Utilized?` [C] ← FCP col T; R `In Flight? (In Dev)` [C] ← FCP col V; S `Analysis Candidate` [C] ← FCP col O (idx_FCP_AnalysisCandidate); T `Is Replaced?` [C] ← FCP col U
  (the raw Y/N flags are *entered* on the Filtering Control Panel; MDV mirrors them)
- U `Mission Critical per Deloitte` [U, dropdown lst_YesNo: Y / N (Options!D14:D15) — Dashboard counts test for "Y"]
- V `Disposition Status` [C] = VLOOKUP(A, tab_DispositionCP, idx_DCP_Disposition)
- W `IT Score` [C] = `HLOOKUP(A, tab_IT_WeightedScore, idx_AppScore_IT=41, FALSE)` → IT!row 44
- X `Business Score` [C] = `HLOOKUP(A, tab_BV_WeightedScore, idx_AppScore_Business=25, FALSE)` → Business!row 28
- Y `% IT Survey Complete` [C] ← IT!row 6

**IT ratings mirror (all [C], HLOOKUP from IT sheet)**: Z group header `Technical Competence`; AA Availability, AB Support Complexity, AC Support Volume, AD Technical Capability, AE Ability to Upgrade, AF SLA Compliance, AG Application Stability, AH Disaster Recovery Capability, AI Scalability, AJ Adaptability/Extensibility, AK Portability, AL Quality, AM Performance, AN Maintainability; AO header `Architecture / Infrastructure`; AP Complexity, AQ Reusability, AR Adherence to EA Standards; AS header `Techical Risk` (sic); AT DR Criticality, AU Vendor Support – Database, AV Vendor Support – Platform, AW Vendor Support – Integration, AX Security Current State, AY Capacity Constraint, AZ Dependence on Specialized/Limited Technical Knowledge; BA Additional Comments; BB header `Non-report related questions`; BC Business Criticality, BD Data Sensitivity, BE Supports Multiple Businesses, BF Alignment with Strategic IT Plan.

**Business ratings mirror [C]**: BG `% Business Survey Complete`; BH Business Units Using The Application, BI Functional Alignment with Strategic Business Plan, BJ Importance for BUs' Programs and Objectives, BK Business Value of the Application, BL Purpose of the Application, BM Owner Satisfaction, BN User Interface, BO User Satisfaction, BP Business Capabilities, BQ Ability to Meet Known Future Requirements, BR Support of Operational Efficiency, BS Additional Comments.

**Demographics mirror [C]**: BT `% Demographics Survey Complete`; BU–FY mirror every Demographics row (IT Owner, App Administrator, App Developer, App SME, Participants, Project ID, Department, Business Process, Sub-Process, Application Replacement, Named/Concurrent Users, Business Unit 1–31 + Other, Application Information block (Source, Category, Development Source, Vendor, Version, License, Package, Level of customization, Refresh Schedule, Architecture, Application Languages, Application Size, Named Users, Concurrent Users, Application Usage, Application Support, Deployment Scope, Date of initial deployment, Total Years of Use, Application Maturity, Managed, Support Hours, Application Size (2nd)), Hardware block (Host Name, Environments, Production Instances, Primary/Secondary Hardware Platform, Primary/Secondary OS, Server IDs/Models/CPUs/CPU speed/Memory, Storage, Allocated Storage, Server Locations), Database block (Primary DB Vendor/Version/Type, Secondary DBs, DB Hosts, DB Sizes), Middleware, Other Software/Tools, Additional Comments from IT / from Business. Generic formula: `=IFERROR(IF(HLOOKUP($A13, tab_Demographics, c_offset_Demo + <col>$11, FALSE)=0,"", HLOOKUP(...)),"")` where row 11 holds the Demographics source-row number and `c_offset_Demo = -2`.

### 2.2 Survey sheet layout (all four surveys are TRANSPOSED — one column per app)

Common pattern (IT / Business):
- Row 4: App ID header — `=Demographics!C6` etc. (chain back to MDV App IDs); columns J onward are app columns (capacity ≈ 1,000+; formulas pre-filled across J:AET ≈ 1,012 columns).
- Row 5: App Name — `=IFERROR(VLOOKUP(J4, tab_MDV, idx_MDV_AppName, FALSE),"")`.
- Row 6: `Survey % complete` [C].
- Row 7: owner row (IT Owner / Business Unit) [U]; Row 8: `Status` [U — oddly validated against `lst_Disposition`].
- Column A: question name; Column B: question description; Columns C–G: the 1–5 scoring guideline text; Column H: `Rating` (importance, mirrored from Weightings CP); Column I: `Weight` (mirrored from Weightings CP).
- Answer cells [U]: integers 1–5, list-validated against name `SCORE15` (Lookup!$D$19:$D$23 = 1,2,3,4,5).

#### IT sheet (rows 4–70)
Question rows and sections (24 weighted questions):
- **Technical Competence** (rows 10–23, 14 questions): Availability, Support Complexity, Support Volume, Technical Capability, Ability to Upgrade, SLA Compliance, Application Stability, Disaster Recovery Capability, Scalability, Adaptability/Extensibility, Portability, Quality, Performance, Maintainability.
- **Architecture / Infrastructure** (rows 26–28, 3): Complexity, Reusability, Adherence to Enterprise Architecture Standards.
- **Technical Risk** (rows 31–37, 7): Disaster Recovery Criticality, Vendor Support – Database, Vendor Support – Platform, Vendor Support – Integration, Security Current State, Capacity Constraint, Dependence on Specialized/Limited Technical Knowledge.
- Row 38 `Correction Factor` [C]: `=IFERROR(MAX(1/SUMIF(J10:J37,"<>N/A",$I$10:$I$37),1),0)`.
- Row 41 Additional Comments [U free text].
- Row 44 **IT Health Score** [C]: `=SUMPRODUCT($I$10:$I$37, J10:J37) * J$38`.
- Rows 46–49 **Non-Report Related Questions** (4, separately weighted in col I on the sheet itself, dropdown `Ratings` in H46:H49, default all "Normal" → 0.25 each): Business Criticality, Data Sensitivity, Supports Multiple Businesses, Alignment with Strategic IT Plan. Weight formula: `=VLOOKUP($H46,Ratings2,2,FALSE)/SUM(VLOOKUP(H46..H49...))`.
- Row 50 **Non-Report IT Health Score** [C]: `=SUMPRODUCT($I$46:$I$49, J46:J49)` (no correction factor). This score is informational only — it does NOT feed the disposition.
- Example scoring guideline (Availability): 1 = "Inconsistent availability and/or performance level" … 5 = "Always available when needed, and at the expected performance level". (All guideline texts are on the sheet, cols C–G; the Weightings CP mirrors them.)

#### Business sheet (rows 4–29)
11 weighted questions in 2 sections:
- **Business Strategic Importance** (rows 11–15, 5): Business Units Using The Application (guideline: 1,2,3,4,"5 or more business units"), Functional Alignment with Strategic Business Plan, Importance for Business Units' Programs and Objectives, Business Value of the Application (Low…High), Purpose of the Application (Utility/Admin Support, Key back-office, Key to run the business, Key customer facing application, Strategic Program/Competitive Advantage).
- **Operations** (rows 18–23, 6): Owner Satisfaction, User Interface, User Satisfaction, Business Capabilities, Ability to Meet Known Future Requirements, Support of Operational Efficiency.
- Row 24 `Correction Factor` [C]: `=IFERROR(MAX(1/SUMIF(J11:J23,"<>N/A",$I$11:$I$23),1),0)`.
- Row 27 Additional Comments [U]. Row 28 **Business Health Score** [C]: `=SUMPRODUCT($I$11:$I$23, J11:J23) * J$24`.

#### Demographics sheet (rows 4–140)
Not scored; pure data collection, one column per app starting col C (row 6 = App ID `=IFERROR(SMALL(MDV A13:A1014, COLUMN()-COLUMN($B$6)),0)`; row 7 = App Name).
- Row 5 warning flag: `=IF(C8="N/A","Data!","")`.
- Row 12 `Survey % Complete` [C]: `(COUNTA of answer blocks C14:C27, C29:C59, C62:C84, C87:C107, C109:C116, C118:C119, C121:C135) / (total row count of those blocks)` → 119 counted fields.
- Sections & rows:
  - **General Information** (14–27): IT Owner, App Administrator, App Developer, App SME, Participant's Name (IT), Participant's Name (Business), Project ID, Department/Functional User, Business Process, Sub-Process, Application Comparison, Application Replacement, Named Users, Concurrent Users.
  - Row 13 `Status` [U — validated `lst_Disposition`], rows 8–11 App Description / L0 / L1 / L2 [C from MDV].
  - **Business** (29–60): Business Unit 1…31 + Other — Yes/No per BU (validation `YESNO` = Lookup Yes/No).
  - **Application Information** (62–84): Source, Category, Development Source, Vendor, Version, License, Package, Level of customization (dropdown `customization`: Low/Medium/High), Refresh Schedule, Architecture, Application Languages, Application Size, Named Users, Concurrent Users, Application Usage, Application Support (FTEs), Deployment Scope, Date of initial deployment or purchase, Total Years of Use, Application Maturity, Managed, Support Hours, Application Size (row 84, dropdown `applicationsize`: Small/Medium/Large).
  - **Technical Infrastructure → Hardware** (87–107): Host Name/Instance, Environments, Production Instances, Primary/Secondary Hardware Platform, Primary/Secondary OS, Primary/Secondary Server ID, Server Models, Total CPUs, CPU Speed, Memory Size, Storage, Allocated Storage, Server Locations.
  - **Database Information** (109–116): Primary DB Vendor / Version / Type-Structure, Secondary Databases, Primary/Secondary DB Host, Primary/Secondary DB Size (MB).
  - **Infrastructure Tools / Middlewares** (118–119): Middleware, Other Software/Tools.
  - **Business Applications Supported** (121–136): Application Systems 1–16, Yes/No each.
  - **Comments** (138–139): Additional Comments from IT / from Business.

#### Finance sheet (rows 4–53)
One column per app starting col D (`=Demographics!C6` chain). 24 currency line items [U] + computed rows:
- **Hardware/Infrastructure Costs** (7–12): Mainframe, Mid-Range, Storage, Disaster Recovery, Service Desk/Data Center, Other. Sub Total row 13.
- **Software Costs → App Maintenance** (17–21): Internal Staff, Captive Offshore, On-Shore Contractor/Consultants, Off-Shore Contractor/Consultants, Other. Sub Total row 22.
- **App Development Costs** (25–29): same 4 staffing categories + Other. Sub Total row 30.
- **Commercial Software Costs** (33–36): Mainframe, Mid-Range, Desktop & Laptop, Other. Sub Total row 37.
- Row 38 **Grand Total** [C]: `=D37+D30+D22+D13`.
- **Past Costs** row 41: Initial Implementation. **Future Costs** row 44: Planned Upgrade. **Budget/Revenue** rows 47–48: Budget Allocation, Revenue Generation. Comments row 51.
- Row 53 **Financial Score** [C]: `=D38/MAX($D$38:$AB$38)` — grand total normalized against the max across apps (relative cost index 0–1).
- ⚠ In this copy the Sub Total rows (13/22/30/37) contain **no formulas** (blank), so Grand Total evaluates to 0 — a defect to fix in the rebuild (Sub Totals should be SUMs of their blocks).

### 2.3 Capability model (Capability Map sheet)
- `tab_Capability_Map` (A8:C…) [U]: columns **L0 Capability | L1 Capability | L2 Capability** — user pastes the full denormalized capability list (one row per L2, with L0/L1 repeated or left blank).
- Derived tables (populated & de-duplicated by VBA `add_Capability`):
  - `tab_L0_Capability` (N) — distinct L0 list (feeds MDV column G dropdown).
  - `tab_L0_L1_Capability_Relation` (P:Q) — distinct L0→L1 pairs (feeds dependent L1 dropdown; also copied into Heat Map's `tab_L1_Heatmap`).
  - `tab_L1_L2_Relation` (S:T) — distinct L1→L2 pairs (feeds dependent L2 dropdown and Heat Map Data rows).
- Blank L0 / L1 cells are replaced with literal "Level L0" / "Level L1" by the macro before copying.
- Sample model: 13 L1s (Finance, Human Resources, Inbound Transportation, Information Management, Information Technology, Marketing, Merchandise Allocation, Merchandise Buying, Merchandise Planning, Real Estate & Property Development, Selling and Store Operations, TBD, Warehouse Management).

### 2.4 Financial Data (flat table, feeds PIVOT)
Columns A–BD, rows 2–78 (25 app slots × 3 `Version` values: FY08_ACTUAL, FY08_BUDGET, FY08_FORECAST):
`Number` (app #), `Project ID`, `Application Name` [C: `=HLOOKUP($A2, Demographics!$C$6:$T$23, 2, FALSE)` → name from Demographics header], `Version`, `Infrastructure Total`, Mainframe, Mid-Range, Storage, Disaster Recovery, Service Desk/Data Center, Other, `App Maint Total`, Internal Staff_M, Captive Offshore_M, On-Shore Contractor_M, Off-Shore Contractor_M, Other, `App Dev Total`, Internal Staff_D, Captive Offshore_D, On-Shore Contractor_D, Off-Shore Contractor_D, Other, `Software Total`, Mainframe, Mid-Range, Desktop & Laptop, Other, then reference columns `IMR Status` (Invest/Maintain/Retire — `IMR` list), Primary/Secondary Hardware, Primary/Secondary OS, Primary/Secondary Database, DR Criticality, BU1–B10, BP1–BP10. Totals here are static numbers in this copy (imported data), not formulas.

### 2.5 Data-validation option sets (full)

| List (name) | Source | Values |
|---|---|---|
| SCORE15 | Lookup!D19:D23 | 1, 2, 3, 4, 5 |
| SCORE13 | Lookup!E19:E21 | 1, 3, 5 |
| Ratings | Lookup!B29:B34 | labels only: N/A, Less important, Normal, Somewhat important, Important, Very important |
| Ratings2 | Lookup!B29:C34 | label→value map: N/A=0, Less important=1, Normal=2, Somewhat important=3, Important=4, Very important=5 |
| YESNO | Lookup!D3:D4 | Yes, No |
| lst_YesNo | Options!D14:D15 | Y, N |
| customization | Lookup!B2:B4 | Low, Medium, High |
| applicationsize | Lookup!C2:C4 | Small, Medium, Large |
| IMR | Lookup!E3:E5 | Invest, Maintain, Retire |
| lst_Disposition | Options!Y2:Y9 | Re-Design, Terminate, Keep-As-Is, Re-Tool, Remove From List, No Longer Utilized, Unknown, Excludes (IDs 1–8 in Z2:Z9) |
| lkup_Final_Disposition | Options!AK2:AK5 | Re-Design, Terminate, Keep-As-Is, Re-Tool |
| lst_Filter | Options!AF2:AF7 | Out of Scope, No Longer Utilized, Terminate, Replaced, In Flight, Analysis Candidate |
| lkup_MeetsFutureState | Options!AN2:AN4 | Y, N, Partial |
| lst_PostSessionStatus | Options!AB2:AB4 | Added to List, Keep, Mark to Review |
| lkup_ActionPlanAssignment | Options!AH2:AH24 | N/A, Not in Future State, 00 - Keep, 01 - No Longer Utilized, 02 - Terminate, 03 - Mainframe, 04 - Databases Not In Future State, 05 - PowerBuilder, 06 - ERP/CAPPS, 07 - Possible ERP, 08–19 Consolidation categories, "Maybe ERP or COTS incident tracking" (client-specific legacy list) |
| lkup_UsageTimeframe | Options!J2:K6 | 24x7=5, Business hours=4, Business hours+weekends=3, Off-hours only=2, Other=1 |
| lkup_AccessFrequency | Options!M2:N7 | Annually=1, Daily=5, Monthly=3, Quarterly=2, Sporadically=0, Weekly=4 |
| lkup_ImpactRating | Options!P2:Q6 | 1. Very Low=1 … 5. Very High=5 |
| lkup_RTO | Options!S2:T22 | "<2 hours"=20, "2-4 hours"=19 … "1-3 months"=2, ">3 months"=1, "No longer needed"=0 (21 bands) |
| lkup_RankRanges | Options!V2:W6 | rank≥1→5, ≥51→4, ≥101→3, ≥201→2, ≥301→1 (also arrays arr_RankNo={1,51,101,201,301}, arr_RankScore={5,4,3,2,1}) |
| CRITICALITY | Lookup!B16:B19 | Sensitive, Non-Critical, Critical, Vital |
| HARDWARE | Lookup!B9:B12 | Mainframe, Mid-Range, Server, VAX |
| OPERATING | Lookup!C9:C13 | AIX, NCR UNIX, SUN UNIX, VMS, Windows NT |
| DATABASE (name `_xlnm.Database` D9:D16) | Lookup | Informix, MS SQL, Oracle, Progress, RDB, Sybase, Teradata, UDB |
| PLATFORM | Lookup!C18:C24 | Common, Billing, Underwriting, Distribution, Loss Prevention, Policy Admin, Claims (insurance-legacy) |
| SpecificTimeFrameOptions | Options!E14:E34 | <2 hours … No longer needed (RTO bands) |
| Options cols A–I (legacy DDOR/ranking) | Options rows 1–28 | LOCATION, RTO, BUSINESS HR USAGE, ACCESS FREQUENCY, USAGE TIMEFRAME, IMPACT LEVELS, POST SESSION STATUSES, DELIVERY MODE, MANUAL PROCESS, RTO CATEGORY, HOW OFTEN USED, IMPORTANCE lists (see hidden Options sheet dump) |

Validation placements: IT `J10:XFD23, J26:28, J31:37` = SCORE15; IT `H46:H49` = Ratings; IT/Business/Demographics "Status" rows = lst_Disposition; Business `J11:15, J18:23` = SCORE15, `H18:H23` = Ratings; Demographics BU + App-Systems blocks = YESNO, row 84 = applicationsize, row 69 = customization; Weightings K-column cells = Ratings; DCP O7:O10,O12 = lst_Disposition; FCP S13:V1015 = lst_YesNo; MDV U = lst_YesNo, M = lkup_MeetsFutureState, G/H/I = capability cascading lists; Heat Map J3 custom `J3<=100`, J5 custom `100-J3`.

---

## 3. Scoring Methodology (exact weights & formulas)

### 3.1 Importance → weight conversion (Weightings Control Panel)

Each question has an **Importance** dropdown (col K, list `Ratings`): N/A=0, Less important=1, Normal=2, Somewhat important=3, Important=4, Very important=5 (numeric map in `Ratings2`).

**Weight (col L)** = that question's rating divided by the sum of ratings of all questions *in the same score family*:

- Business (rows 17–21 & 24–29, 11 questions):
  `L17 = VLOOKUP($K17,Ratings2,2,FALSE) / SUM(VLOOKUP(K17..K21, K24..K29 ,Ratings2,2,FALSE))`
- IT (rows 33–46, 49–51, 54–60 — 24 questions): same pattern over all 24 K-cells.

So weights always sum to 1 (100%) within each score.

**Current configuration in this copy:**
- Business Value: only 2 questions active — `Business Units Using The Application` = Very important and `Importance for Business Units' Programs and Objectives` = Very important → **0.5 each**; all other 9 questions = N/A → weight 0.
- IT Health: 10 questions = Very important → **0.1 each**: Availability, Support Volume, Scalability, Adaptability/Extensibility, Complexity, Disaster Recovery Criticality, Vendor Support – Platform, Vendor Support – Integration, Security Current State, Dependence on Specialized/Limited Technical Knowledge. Other 14 = N/A → 0.
- (These are project-specific settings, not tool defaults; the rebuild must make them editable.)

Named ranges point at each weight cell: `wt_BV_NoBUs`(L17), `wt_BV_FuncAlign`(L18), `wt_BV_ImportanceforBU`(L19), `wt_BV_BVofApp`(L20), `wt_BV_PurposeofApp`(L21), `wt_BV_OwnerSatisfied`(L24), `wt_BV_UserInterface`(L25), `wt_BV_UserSatisfied`(L26), `wt_BV_BusCapability`(L27), `wt_BV_MeetFutReq`(L28), `wt_BV_SupportOfOpEfficiency`(L29); `wt_IH_TC_Availability`(L33)…`wt_IH_TC_Maintainability`(L46), `wt_IH_AI_Complexity`(L49), `wt_IH_AI_Reuse`(L50), `wt_IH_AI_EAStandards`(L51), `wt_IH_TR_DisasterRecCriticality`(L54)…`wt_IH_TR_DepOnSpecializedKnowledge`(L60).

⚠ Formula quirk: the SUM inside L20/L21/L24–L29 contains a stray empty argument (`…VLOOKUP($K$21,…), , VLOOKUP($K$24,…)…`) — harmless (empty = 0) but present in the file.

### 3.2 Per-application scores

- **IT Health Score** (IT!row 44, 0–5 scale): `SUMPRODUCT(weights I10:I37, answers J10:J37) * CorrectionFactor(J38)` where `CorrectionFactor = IFERROR(MAX(1/SUMIF(answers<>"N/A", weights),1),0)`. Purpose: if some questions were answered "N/A", the score is re-normalized over the weights of answered questions only. (Unanswered/blank cells count 0 in SUMPRODUCT but their weights are still in SUMIF — SUMIF criterion `<>N/A` includes blanks — so blanks *drag the score down*; only literal "N/A" answers are excluded. Note the SCORE15 validation doesn't actually offer "N/A", another quirk.)
- **Business Health Score** (Business!row 28): identical pattern over the 11 Business weights/answers.
- **Non-Report IT Health Score** (IT!row 50): `SUMPRODUCT(I46:I49, J46:J49)` with sheet-local weights (default 0.25 each, editable via H46:H49 Ratings dropdown). Not used downstream.
- **Survey % Complete**: IT!6 `=(COUNT(J10:J23)+COUNT(J26:J28)+COUNT(J31:J37)+COUNT(J46:J49)) / (COUNTIF($I$10:$I$23,">0")+COUNTIF($I$26:$I$28,">0")+COUNTIF($I$31:$I$37,">0")+ROWS(J46:J49))` — i.e., answered count ÷ (number of *weighted>0* questions + the 4 non-report questions). Business!6 analogous over its two blocks. Demographics!12 = COUNTA ratio over 119 fields (see 2.2).
- **Financial Score** (Finance!53): `GrandTotal / MAX(all apps' GrandTotals)`.

### 3.3 Score distribution panel (Weightings CP rows 4–8 + Dashboard rows 41–45)
`E5 = COUNTIFS(lst_MDV_InScope,"Y", lst_MDV_IsUtilized,"Y", lst_MDV_WeightedScore_BV, ">=0", …, "<1")` etc. — buckets 0–1, 1–2, 2–3, 3–4, 4–5 (last bucket `>=4`,`<=5`), plus row of percentages `=E5/$J$5`. Same for IT in rows 7–8.

### 3.4 Statistics columns (Weightings CP M–R and MDV rows 5–10)
Per question, array formulas over in-scope+utilized apps, e.g. `M17 {=MIN(IF(lst_MDV_InScope="Y", IF(lst_MDV_IsUtilized="Y", lst_MDV_BUS_BU_UsingTheApp, ""), ""))}`; Max/Mean/Median/Mode/Count analogous. MDV's own Min/Max/Mean/Median/Mode/Count band (rows 5–10) is populated by VBA `RefreshStatistics_MDV` (respects autofilter visibility; Mode shows "N/A" when filtered).

---

## 4. Disposition (4R) Logic — exact rules

The "4Rs" here are: **Re-Design, Re-Tool, Keep-As-Is, Terminate** (+ `Unknown` when unscored). Cover text maps them to industry terms: Keep-as-is/Retain, Re-tool/Replace, Redesign/Replace, Terminate/Retire.

**Thresholds (Disposition Control Panel E7:H7, adjustable 0–5 in 0.1 steps via spin buttons):**
- `c_Opt_BusinessValue` = E7 = **3** (Optimum BV)
- `c_Urg_BusinessValue` = F7 = **2** (Urgent-review BV)
- `c_Opt_ITHealth` = G7 = **3** (Optimum IT)
- `c_Urg_ITHealth` = H7 = **2** (Urgent-review IT)

**Per-app disposition (DCP col I, one formula, BV = G, IT = H):**
```
IF AppID exists:
  IF BV = 0 OR IT = 0            → "Unknown"          (c_Disposition_Unknown, Options!Y8)
  ELSE IF BV <  3 AND IT >= 3    → "Re-Design"        (c_Disposition_Redesign, Options!Y2)   [Low BV, High IT]
  ELSE IF BV >= 3 AND IT >= 3    → "Keep-As-Is"       (c_Disposition_KeepAsIs, Options!Y4)   [High BV, High IT]
  ELSE IF BV <  3 AND IT <  3    → "Terminate"        (c_Disposition_Terminate, Options!Y3)  [Low BV, Low IT]
  ELSE IF BV >= 3 AND IT <  3    → "Re-Tool"          (c_Disposition_Retool, Options!Y5)     [High BV, Low IT]
```
Exact formula (row 21): `=IF(AND(B21<>"",B21>0), IF(AND(G21<>"",H21<>""), IF(OR(G21=0,H21=0), c_Disposition_Unknown, IF(AND(G21<c_Opt_BusinessValue,H21>=c_Opt_ITHealth), c_Disposition_Redesign, IF(AND(G21>=c_Opt_BusinessValue,H21>=c_Opt_ITHealth), c_Disposition_KeepAsIs, IF(AND(G21<c_Opt_BusinessValue,H21<c_Opt_ITHealth), c_Disposition_Terminate, IF(AND(G21>=c_Opt_BusinessValue,H21<c_Opt_ITHealth), c_Disposition_Retool, ""))))),""),"")`

**Feeder columns (rows 21–1020/1496):** B App ID `=IFERROR(SMALL(MDV!$A$13:$A$1014, rowOffset),"")` (sorted ID list); C/D/E = L0/L1/L2 via VLOOKUP to MDV G/H/I; F App Name; G Business Score / H IT Score = `IFERROR(IF(VLOOKUP(id,tab_MDV,idx_MDV_WeightedScore_BV/IT)="",0,…),0)` (blank→0 so unscored ⇒ Unknown).

**Quadrant summary counts (row 12):** e.g. Re-Design `=COUNTIFS(lst_DCP_WeightedScore_BV,"<"&c_Opt_BusinessValue, lst_DCP_WeightedScore_IT,">="&c_Opt_ITHealth, BV,"<>0", IT,"<>0")`; Unknown `=COUNTIF(lst_DCP_Disposition, c_Disposition_Unknown)`; No Longer Utilized `=COUNTIFS(lst_MDV_InScope,"Y", lst_MDV_IsUtilized,"N")`.

**Urgent-review counts (row 17):** Very Low BV `=COUNTIFS(BV,"<"&c_Urg_BusinessValue, BV,"<>0")`; Very Low IT analogous; plus the NLU count. (Urgent thresholds only drive these counts, not the disposition itself.)

**Helper cols for heat map (Q,R,S,T):** Q=L1, R=L2 (VLOOKUP to MDV), `S=CONCATENATE(L1,"",L2)` composite key, `T=disposition` (blank if 0).

**Spin-button VBA (Sheet24):** `sb_BV_OptReview_SpinUp/Down` → E7 ±0.1 clamped [0,5]; F7, G7, H7 likewise.

**MDV Final Disposition (col K)** = VLOOKUP(A, tab_DispositionCP, 8) — same as col V in practice (col 8 of B-anchored table = I). Manual override list `lkup_Final_Disposition` exists (4 values) and VBA contains (mostly disabled) backup/restore machinery for a "Deloitte Override of Disposition" column that no longer exists.

---

## 5. Filtering Logic (Filtering Control Panel)

User enters per app: **S In Scope (Y/N), T Is Utilized (Y/N), U Is Replaced (Y/N), V In Flight (Y/N)**; W Disposition [C] = `VLOOKUP(A, tab_MDV, idx_MDV_Disposition)`. A App ID [C] = SMALL over MDV IDs; B Acronym, E App Name [C].

**Filter Status (col L)** — first match wins:
```
IF InScope = "N"                                                  → "Out of Scope"        (c_Filter_OutOfScope)
ELSE IF InScope="Y" AND IsUtilized="N"                            → "No Longer Utilized"  (c_Filter_RetiredNLU)
ELSE IF InScope="Y" AND IsUtilized="Y" AND Disposition="Terminate"→ "Terminate"           (c_Filter_RetiredTerminate)
ELSE IF … AND Disposition<>"Terminate" AND IsReplaced="Y"         → "Replaced"            (c_Filter_Replaced)
ELSE IF … AND IsReplaced="N" AND InFlight="Y"                     → "In Flight"           (c_Filter_InFlight)
ELSE                                                              → Disposition value (pass-through)
```

**Analysis Candidate (col O)** = "Y" only if none of the above filters hit (in scope, utilized, not terminate, not replaced, not in flight); otherwise "N".

**Summary counts (row 6):** B6 total apps `=COUNTA(lst_MDV_AppID)`; D6 out-of-scope; F6 NLU; J6 replaced `=COUNTIFS(InScope,"Y", IsUtilized,"Y", Disposition,"<>Terminate", IsReplaced,"Y")`; L6 in-flight (adds IsReplaced="N"); N6 analysis candidates `=B6−SUM(others)`.

MDV columns P/Q/R/T mirror S/T/V/U and col S mirrors O (`idx_FCP_AnalysisCandidate` = columns O:Q of tab_FCP).

---

## 6. Capability Model & Heat Map Rules

### 6.1 Heat Map Data (rows 3…1104, one row per L1+L2 pair from tab_L1_L2_Relation)
- I=L1, J=L2 (from table), K `Flag for L1 display` `=IF(I2=I3,0,1)` (1 on first row of each L1 group), L `Column` `=SUM(L3+K4)` running L1 index, M `Row` `=IF(K=1,1,prev+1)` position within the L1 group, N composite key `=CONCATENATE(L1,"",L2)`.
- C `App Count` `=IF(N>" ", COUNTIFS(DCP!$S$21:$S$1021, N, DCP!$T$21:$T$1021, "<>Unknown"), 0)` — apps mapped to this L1+L2 with a known disposition.
- D `TERMINATE` count `=COUNTIFS(DCP!S, N, DCP!T, c_Disposition_Terminate)`.
- E `RETOOL/REDESIGN` count `=COUNTIFS(…Redesign) + COUNTIFS(…Re-Tool)`.
- F **4R Quadrant (the cell color decision)**:
  `=IF(C=0, "", IF(D > ROUNDUP('Heat Map'!$J$1 * C, 1), "Terminate", IF(E > ROUNDUP(('Heat Map'!$J$3 − 'Heat Map'!$J$1) * C, 1), "Redesign", "Retain")))`

### 6.2 Threshold panel ('Heat Map' J1/J3/J5)
- J1 = **0.10** → "Terminate more than 10% of the apps" ⇒ L2 colored red.
- J3 = **0.26** → "Retool/Redesign or Terminate more than 26% of the apps" ⇒ yellow (the formula uses J3−J1 = 16% against the Retool+Redesign count).
- J5 [C] `=1−J3` = 0.74 → "Retain more than 74%" ⇒ green.
- G6 validation message: `=IF(J3<J1,"Error: The % of app to Retool/Redesign/Terminate must EXCEED the % of apps to terminate", IF(J3+J5<>1,"Error: Sum of Retool/Redesign and Retain percentages must be 100",""))`.
- Note ROUNDUP(x,1) rounds up to **1 decimal place** (not to an integer) — with integer counts this effectively means `count > threshold%×total` (strict), e.g. 2 terminates of 10 apps: 2 > ROUNDUP(1.0,1)=1 → Terminate.

### 6.3 Rendering (VBA `generate_Heatmap`, button "Generate/Refresh Heatmap")
1. Clears Heat Map D8:OJ4020 (contents + fill), rebuilds `tab_L1_Heatmap` from tab_L0_L1_Capability_Relation[L1], sorted + de-duplicated.
2. Pastes distinct L1 names transposed across row 8 starting at D8 (`start_Heatmap` = 'Heat Map'!$D$8), dark fill.
3. For every Heat Map Data row: writes the L2 name at `D8.Offset(row M, column L−1)` and colors the cell from column F:
   - "Terminate" → fill **RGB(204,0,0)**, white text
   - "Redesign" → fill **RGB(255,255,0)**, black text (covers Re-Tool too — one yellow bucket)
   - "Retain" → fill **RGB(0,176,80)**, white text
   - else (blank/no apps) → white fill, black text
4. Bold + wrap + borders on the matrix.
- `clear_CapabilityMap` (button "Clear Capability Map") empties the three relation tables and the Heat Map matrix.
- `add_Capability` (button on Capability Map) rebuilds the relation tables from tab_Capability_Map (replace blanks with "Level L0"/"Level L1", copy, sort, RemoveDuplicates on L0 / (L0,L1) / (L1,L2)).

The Heat Map is a **matrix: columns = L1 capabilities, cells below = that L1's L2 capabilities, colored by aggregated disposition**. L0 is not shown on the heat map (only used for cascading dropdowns).

---

## 7. Financial Model

- **Finance survey** (per app, §2.2): TCO categories Hardware/Infrastructure (6), App Maintenance (5), App Development (5), Commercial Software (4), plus Past (Initial Implementation), Future (Planned Upgrade), Budget Allocation, Revenue Generation. Grand Total = sum of 4 sub-totals; Financial Score = GrandTotal / max GrandTotal across apps. (Sub-total formulas missing in this copy — see quirks.)
- **Financial Data sheet**: separate imported cost dataset keyed by app number & fiscal version (FY08_ACTUAL / FY08_BUDGET / FY08_FORECAST), with per-category totals (Infrastructure, App Maint, App Dev, Software) and staffing splits (Internal/Captive Offshore/On-/Off-Shore Contractor), plus IMR status and environment reference columns. No savings formulas exist on this sheet — "savings" analysis is implicitly Actual vs Budget vs Forecast comparison in the PIVOT.
- **PIVOT sheet**: three pivot views over Financial Data:
  1. By `Version` (rows) × Sums of Mid-Range, Storage, Disaster Recovery, Other, Internal Staff_M, Captive Offshore_M, On-Shore Contractor_M, Off-Shore Contractor_M, Internal Staff_D…, Mainframe, Mid-Range2, Desktop & Laptop; filter: Application Name.
  2. Totals: Sum of App Maint Total, Infrastructure Total, App Dev Total, Software Total; filters: Version, Application Name.
  3. Sum of Mid-Range / Storage / Disaster Recovery / Other; filters: Version, Primary OS, Application Name.
- There is **no** link from Finance/Financial Data into the disposition logic — cost is context only.

---

## 8. Dashboard / Reporting KPIs

All formulas COUNTIFS over MDV named column ranges, restricted to `InScope="Y"` and `IsUtilized="Y"` where noted:

- **2×2 matrix counts** (D13/F13/D18/F18): Redesign (L16), Keep-As-Is (L17), "Terminate + NLU" (`=L14 & "+" & L13`), Retool (L15).
- **Disposition pie** (K11:L17): Unknown, Out Of Scope `=COUNTIF(lst_MDV_InScope,"N")`, No Longer Utilized `=COUNTIFS(InScope,"Y",IsUtilized,"N")`, Candidates For Termination, Retool, Redesign, Keep As Is.
- **Mission Critical pie** (P10:Q11): `=COUNTIFS(InScope,"Y",IsUtilized,"Y",MissionCritical,"Y")` vs `"<>Y"`.
- **Application Universe bar** (P22:Q23): In Scope vs Out Of Scope counts.
- **Collection Progress** (rows 33–35, for Demographics / Business Ratings / IT Ratings): Complete `=COUNTIFS(lst_MDV_Completion_X,1)+COUNTIFS(InScope,"N",Completion,"")`; Partial `=COUNTIFS(Completion,">0"(Demo: ">0.02"),Completion,"<1")`; Missing `=COUNTIFS(Completion,<=0.02 or =0)`; each with % of row total. (Demographics uses a 2% floor to ignore the always-present Status row.) ⚠ Copy-paste bug in K35 (IT Ratings "Complete"): its second term counts `COUNTIFS(lst_MDV_InScope,"N", lst_MDV_Completion_BV,"")` — it references the **Business** completion column instead of `lst_MDV_Completion_IT`. Fix in the rebuild.
- **Score distribution bars** (rows 41–45): mirror of Weightings CP E5:I5 / E7:I7 buckets (1..5) for Business Value and IT Condition, with % rows.
- **Mission-critical list section**: VBA `RefreshData_MissionCritical` fills App IDs of mission-critical apps below the charts (named refs `idx_DB_MC_HR` / `idx_DB_MC_AppID` are `#REF!` in this copy — broken, see quirks).
- **4R Framework chart** (chart on its own tab): ScatterChart titled "…R Framework": series1 X=`DCP!$G$21:$G$1020` (Business Score), Y=`DCP!$H$21:$H$1020` (IT Score); series2 = horizontal threshold line (X=C15:H15 = 0…5, Y=C14:H14 = c_Opt_ITHealth repeated); series3 = vertical threshold line (X=C19:H19 = c_Opt_BusinessValue repeated, Y=C18:H18 = 0…5). Axis labels on sheet: "IT Score" / "Business Score". Legacy `CreateScatterChart` macro (frmreport form) builds an alternative scatter from MDV W/X with app-name data labels; `Delete_Charts` removes it.

---

## 9. VBA Automation Inventory

Modules (olevba extraction; empty sheet classes omitted):

| Module | Procedure | Trigger | Function |
|---|---|---|---|
| Module3 | `Demographics`, `IT`, `Business`, `Financial`, `FinancialData` | Cover/menu buttons | Simple `Sheets("…").Select` navigation. `Summary()` commented out ("APS 5.0"). |
| Module5 | `CreateScatterChart` | frmreport `btnreport1` | Builds "Scatter Report" chart sheet from MDV `W13:X4013` (IT vs BV), fixed 1–5 axes, title "Business Value / IT Condition Matrix", data labels = app names from MDV B9:B269. |
| Module4 | `CreateBubbleChart` | frmreport `btnreport2` | Entirely commented out (APS 5.0) — non-functional. |
| Module2 | `Delete_Charts` | button | Deletes the "Scatter Report" sheet (bubble deletion commented out). |
| Module1 | `Macro1` | none | Recorded scrolling junk — dead code. |
| Module7 | `add_Capability` | "Refresh/enter Capability Map" button | Rebuilds tab_L0_Capability, tab_L0_L1_Capability_Relation, tab_L1_L2_Relation from tab_Capability_Map: blanks→"Level L0"/"Level L1", copy columns, sort, RemoveDuplicates (L0; L0+L1; L1+L2); status text in B5. |
| Module9 | `clear_CapabilityMap` | "Clear Capability Map" button | Empties tab_Capability_Map + tab_L1_L2_Relation and clears Heat Map D8:OJ4020 contents/fill. |
| Module8 | `generate_Heatmap` | "Generate/Refresh heatmap" button | Full heat-map render (see §6.3) incl. disposition→RGB color mapping. |
| Module10 | `clear_MasterDataView`, `clear_ITTab`, `clear_BusinessTab`, `clear_DemographicTab` | reset buttons | Bulk-clear constants: MDV rows 13:5307 (constants only, keeps formulas); IT J10:EXW23/J26:28/J31:37/J46:49/J41/J7:8; Business J11:15/J18:23/J27/J7:8; Demographics C13:EXP27, C29:60, C62:84, C87:107, C109:116, C118:119, C121:136, C138:139. |
| Module6 | `Auto_Open` | workbook open | Expands MDV outline, repositions `btn_MDV_RefreshStatistics` button, collapses outline. |
| Module6 | `Get_MDV_InScope(arr, n)` | helper | Autofilters MDV on InScope="Y" & IsUtilized="Y", collects visible App IDs (count via `[COUNTIFS(lst_MDV_InScope,"Y",lst_MDV_IsUtilized,"Y")]`). |
| Module6 | `Get_MDV_MissionCritical(arr, n)` | helper | Same + MissionCritical="Y", sorted by App Name. |
| Module6 | `mc_RefreshData_Disposition` | "Refresh" button on DCP | Re-syncs DCP rows with in-scope apps: gets IDs, deletes surplus rows, autofills formulas C:I down from row 21 (`idx_DCP_HR`+1), writes App IDs into col C. Override backup/restore (`GetDispositionValues`/`RestoreDispositionValues` via a temp "DCP_Backup" sheet copy) exists but the calls are commented out. |
| Module6 | `RefreshData_MissionCritical` | Dashboard button | Fills mission-critical app list on Dashboard (insert/delete rows ≥70 to preserve legend layout, autofill A:J) — depends on broken `idx_DB_MC_*` names. |
| Module6 | `RefreshStatistics_MDV` | `btn_MDV_RefreshStatistics` | Writes Min/Max/Mean/Median/Mode/Count into MDV rows 5–10 for all 24 IT + 11 Business rating columns using `lst_MDV_*`/`idx_MDV_*` names, respecting current autofilter (visible cells only; Mode = "N/A" when filtered). |
| Module6 | `mc_ReSortRank_ListR1/R2`, `mc_RefreshData_ListR1/R2/R4` | (disabled) | Legacy DDOR/ranking machinery, fully commented out in APS 5.0 (RTO custom sort order "<2 hours,…,No longer needed", rank autofill). |
| Sheet24 (DCP) | `sb_IT_OptReview_SpinUp/Down`, `sb_IT_UrgReview_*`, `sb_BV_OptReview_*`, `sb_BV_UrgReview_*` | spin buttons | ±0.1 on G7/H7/E7/F7, clamped MIN(5,…)/MAX(0,…). |
| Sheet18 (Weightings CP) | `Worksheet_Change` | edit K20:K30 | Would re-sort ranking lists (calls commented out); now just re-selects the Weightings sheet. |
| Sheet12 | `CommandButton1_Click` | — | Commented out. |
| frmreport | `btncancel_Click`, `btnreport1_Click`, `btnreport2_Click` | report chooser form ("Choose the report type…": "Business Value / IT Condition (Scatter)" / "(Bubble)") | Cancel / CreateScatterChart / CreateBubbleChart. |
| ThisWorkbook | — | — | empty. |

**No VBA writes to Change Log or Error Log** — both are purely manual registers (see §below). olevba flags (WMI/hex/base64/VBA-stomping) are generic false positives; no malicious or external-IO code is present.

### Change Log / Error Log structure
- Change Log columns: S.No | Change(s) done | By | When | Reason | Requested By | (G unheaded approver) | Changes Approved By | Comments. 23 manual entries documenting v2.0 (2008) → v3.0 (2009, added rating values & 1–5 scale) → v4.0 (2012–13, added Ranking Data, Dashboard, MDV, Disposition CP, Weightings CP, Filtering CP) → v5.0 (2016, disabled ranking/bubble, added capability map & heat map).
- Error Log columns: S.No | Error(s) | Reason | Reported By | Action Needed | Fixed By | Comments | Checked By. One template row.

---

## 10. Named Ranges & Configuration (key ones)

**Constants:** `c_offset_IT = -3`, `c_offset_BV = -3`, `c_offset_Demo = -2`, `c_offset_RD = 0`, `c_DCP_adjust = 1` (translate sheet row numbers into HLOOKUP row indexes within the survey tables); `arr_RankNo = {1,51,101,201,301}`, `arr_RankScore = {5,4,3,2,1}`; `calc_DDOR_Rank = 5/389`, `calc_DDORs = 5/60`, `calc_RTO = 5/20` (legacy ranking scalers); `CountApps = COUNTA(Demographics!$C$7:$AA$7)`.

**Threshold/disposition constants:** `c_Opt_BusinessValue`='DCP'!E7, `c_Urg_BusinessValue`=F7, `c_Opt_ITHealth`=G7, `c_Urg_ITHealth`=H7; `c_Disposition_Redesign/Terminate/KeepAsIs/Retool/Unknown` → Options!Y2/Y3/Y4/Y5/Y8; `c_Filter_OutOfScope/RetiredNLU/RetiredTerminate/Replaced/InFlight/AnalysisCandidate` → Options!AF2–AF7.

**Table ranges:** `tab_MDV` = MDV!A13:FY1014; `tab_IT_WeightedScore` = IT!J4:AES10000; `tab_BV_WeightedScore` = Business!J4:AES10000; `tab_Demographics` = Demographics!C6:AES10007; `tab_DispositionCP` = DCP!B21:Y1496; `tab_FCP` = FCP!A13:X457; `tab_ListR1`; `start_Heatmap` = 'Heat Map'!D8. Excel ListObjects: tab_Capability_Map, tab_L0_Capability, tab_L0_L1_Capability_Relation, tab_L1_L2_Relation, tab_L1_Heatmap, Table6 (DCP C20:I1020).

**Column/row indexes:** ~150 `idx_*` names. Survey-side: `idx_IT_*` = `ROW(IT!$A$n)+c_offset_IT` (e.g. idx_IT_Availability→row 10−3=7 within tab_IT_WeightedScore), `idx_BUS_*`, `idx_DEM_*`; `idx_AppScore_IT = 41` (IT row 44−3), `idx_AppScore_Business = 25` (Business row 28−3), `idx_IT_Survey_PercentComplete` (IT J6→3), `idx_BUS_Survey_PercentComplete`. MDV-side: `idx_MDV_<field> = COLUMN(MDV!$<col>$12)` for every mirrored field; `idx_MDV_HR = ROW(MDV!$A$12)`, `idx_MDV_Statistics_Min = ROW(MDV!$AA$5)`. DCP: `idx_DCP_AppID/OPR/Acronym/AppName/WeightedScore_BV/WeightedScore_IT/Disposition = COLUMN(cell)−c_DCP_adjust`, `idx_DCP_HR = 20`. FCP: `idx_FCP_FilterStatus = COLUMN(L12:N12)`, `idx_FCP_AnalysisCandidate = COLUMN(O12:Q12)`.

**Column lists (`lst_*`):** lst_MDV_AppID (A13:A1014), lst_MDV_InScope (P), lst_MDV_IsUtilized (Q), lst_MDV_InFlight (R), lst_MDV_IsReplaced (T), lst_MDV_MissionCritical (U), lst_MDV_Disposition (V), lst_MDV_WeightedScore_IT (W), lst_MDV_WeightedScore_BV (X), lst_MDV_Completion_IT/BV/Demo (Y/BG/BT), one `lst_MDV_*` per rating column (AA…BR); lst_DCP_AppID/Disposition/WeightedScore_BV/IT (DCP C/I/G/H 21:1496); lst_FCP_InScope/IsUtilized/IsReplaced/InFlight (S/T/U/V 13:978); lst_IT_WeightedScore (IT J44:AET44); lst_BV_WeightedScore (Business J28:AET28); lst_Disposition, lst_DispositionID, lst_Filter, lst_YesNo, lst_PostSessionStatus.

**Broken (`#REF!`) names — legacy of deleted sheets ("Ranking Data", "List R2/R4", "Weighted Ranking Scores", BCG columns):** all `idx_RD_*` (~60), `wt_AR_*` (14 "Application Ranking" weights), `wt_IH_NRRQ_*` (4), `tab_RankingData`, `tab_ListR2`, `tab_AR_WeightedScore`, `lst_AR_WeightedScore`, `idx_DB_MC_AppID/HR` (Dashboard mission-critical refresh), `idx_MDV_OPR/ReplacedBy/AppRank/…`, `n_AR_SumOfWeights`, `_AppID`, `Businesstotal`, `col_ID`, `Finance`, `Geographical`, `l1_capability`, `MissionCriticalPerDt`, `Process`, `tbl_L1_Capability`. Several names also point at external workbooks ([1],[2],[3],[5],[6]) — dead links.

**Legacy DDOR/ranking numeric indexes** (into the deleted Ranking Data sheet): idx_DDOR_Rank=17, idx_DDORRank=18, idx_MissionCritical=19, idx_RTO=20, idx_NoOfDDORs=22, idx_PublicFacing=24, idx_UsageTimeframe=25, idx_AccessFrequency=27, idx_ManualWorkAround=28, idx_Safety=30, idx_BusOps=32, idx_RegulatoryComp=34, idx_PublicPerception=36, idx_AppsDepOnThisApp=38, idx_AppsDependentUpon=39, idx_RevisedOPR=12, idx_DeloitteRank=65, idx_Acronym=6, idx_ApplicationName=7. (Only relevant if the deprecated ranking feature is resurrected.)

**List R1 sheet:** legacy report — A=App ID, B=DDOR (VLOOKUP tab_MDV idx_MDV_OPR → #REF now), C=Acronym, D=Application Name, E=DDOR Rank, F=Specific Time frame (RTO), G=R1 Rank; sort order for RTO was the custom list "<2 hours, 2-4 hours, …, No longer needed". Effectively dead in v5.0.

---

## 11. Observed Quirks / Ambiguities Requiring a Decision in the Rebuild

1. **Finance Sub Totals are empty** — rows 13/22/30/37 have labels but no SUM formulas, so Grand Total (=sum of subtotals) and Financial Score are always 0/#DIV/0!. Rebuild should compute subtotals properly.
2. **"N/A" answers vs blanks in scoring**: the correction factor excludes only literal "N/A" text answers, but the SCORE15 dropdown offers only 1–5 — there is no supported way to answer N/A. Decide: add an explicit N/A option (recommended, matching the correction-factor intent) or treat unanswered as excluded.
3. **Blank answers score as 0** but still count in the weight denominator → a partially-surveyed app gets a *deflated* score rather than a renormalized one; only a 0 score (i.e. nothing answered in weighted questions) yields "Unknown". Decide whether partial surveys should renormalize or be flagged.
4. **Boundary rule**: score exactly equal to the Optimum threshold (default 3.0) counts as "high" (>=). Preserve `>=` semantics.
5. **Mission Critical flag mismatch**: MDV col U validates Yes/No (`lst_YesNo` = Y/N actually — Options!D14:D15 holds "Y","N") while Dashboard counts `"Y"` vs `"<>Y"`; the Lookup sheet's YESNO list is "Yes/No". Standardize on one Y/N vocabulary.
6. **"Status" rows on Demographics/IT/Business are validated against the Disposition list** (Re-Design/Terminate/…): looks like a copy-paste validation error; likely intended to be a survey status. Decide intended semantics.
7. **Urgent Review thresholds (E7/F7 = 2)** produce only counts ("Very Low BV/IT"), no separate disposition. Keep as a flag/alert, not a 5th disposition.
8. **Disposition override**: VBA retains disabled backup/restore of a "Deloitte Override of Disposition" column, and MDV has both `Final Disposition` (K) and `Disposition Status` (V) currently computed identically. lkup_Final_Disposition (4 values) suggests K was meant to be a manual override defaulting to the computed value. Recommend: computed disposition + optional manual override field.
9. **Non-Report IT questions** (Business Criticality, Data Sensitivity, Supports Multiple Businesses, Alignment with Strategic IT Plan) have their own local weights and score that go nowhere. Decide whether to keep as informational attributes.
10. **Heat Map "Redesign" bucket merges Re-Tool + Re-Design** into one yellow color; disposition names on Options ("Re-Design"/"Re-Tool") vs heat-map VBA cases ("Redesign"/"Retool"/"Retain"/"Terminate") don't match exactly — VBA compares Heat Map Data col F values ("Terminate"/"Redesign"/"Retain"), which are generated by the F-column formula, so it works, but the vocabulary is inconsistent across layers ("Keep-As-Is" ↔ "Retain").
11. **ROUNDUP(x,1)** in the heat-map threshold rounds to one decimal, not to a whole app; with strict `>` this is equivalent to "strictly more than threshold-fraction of apps (to 0.1 precision)". Replicate carefully or simplify to `count/total > threshold`.
12. **Hard-coded ranges with mismatched extents everywhere**: MDV 1,002 rows; DCP formulas to row 1020 but table/named ranges to 1496; FCP formulas to 1015 but tab_FCP to 457 and lst_FCP_* to 978; surveys pre-filled ~1,012 columns; Heat Map Data 1,102 rows; heat map paint area D8:OJ4020 (≈400 L1 columns). A rebuild should use unbounded collections.
13. **Legacy/broken artifacts**: ~145 `#REF!` names (workbook-level names whose definition contains `#REF!`), references to deleted sheets (Ranking Data, List R2/R4, Weighted Ranking Scores, Summary, Drop-Downs), external workbook links, dead macros (Macro1, bubble chart), Dashboard mission-critical refresh depends on broken names. The whole DDOR/RTO ranking subsystem (Options cols A–I & S–W, arr_Rank*, calc_*, List R1) is deprecated as of APS 5.0 — exclude from the rebuild unless resurrecting ranking.
14. **Duplicate/typo names**: `lst_MDV_IT_TR_VendorSupport_Platform` points at the *Database* column AU (copy/paste bug — Platform is AV); `idx_MDV_Dem_AI_Source` vs `Development Source` naming; "Techical Risk", "Cloumn", "buisness" typos; two "Application Size" and two "Named/Concurrent Users" fields in Demographics (General Info vs Application Info sections).
15. **Weight formula stray comma** (empty SUM argument) in Business rows 20–29 — cosmetic.
16. **Demographics % complete floor**: Dashboard treats ≤2% as "Missing" for Demographics because one row (Status) is systematically populated; a clean rebuild can drop this hack.
17. **PIVOT caches** hold FY08 client-sample aggregates; Financial Data app names resolve via HLOOKUP over only the first 18 Demographics columns (C:T) — capacity mismatch with the 1,000-app design.
18. **4R chart axis orientation**: the framework chart plots X = Business Score (DCP!G) and Y = IT Score (DCP!H); the legacy VBA scatter plots X = IT (MDV!W), Y = BV (MDV!X) with axis titles swapped ("Business Value" on X, "IT Condition" on Y). Pick one convention (recommend X = Business Value, Y = IT Health, quadrant labels per §4).
19. **Dashboard IT "Complete" count bug**: Dashboard!K35 (IT Ratings row) uses `lst_MDV_Completion_BV` instead of `lst_MDV_Completion_IT` in its second COUNTIFS term (out-of-scope apps with blank completion) — copy-paste error from the row above; found during independent verification.

---

## Verification Log

Date: 2026-07-17. Independent re-derivation of all critical facts directly from `excelapp.xlsm` (openpyxl for formulas/values/validations/defined names, olevba for VBA, raw chart XML for series ranges), then diffed against this document.

| # | Item | Result | Notes |
|---|---|---|---|
| 1 | Scoring formulas | PASS | IT!J44 `=SUMPRODUCT($I$10:$I$37,J10:J37)*J$38`, IT!J38 `=IFERROR(MAX(1/SUMIF(J10:J37,"<>N/A",$I$10:$I$37),1),0)`; Business!J28/J24 identical pattern over I11:I23/J11:J23. Verbatim match, incl. survey-%-complete formulas and Non-Report score IT!J50. |
| 2 | Weights | PASS | Ratings2 map N/A=0…Very important=5 confirmed. BV: exactly K17 & K19 = "Very important" (Business Units Using The App; Importance for BUs' Programs) → 0.5 each, other 9 = N/A. IT: exactly the 10 questions listed (K33,K35,K41,K42,K49,K54,K56,K57,K58,K60) = "Very important" → 0.1 each, other 14 = N/A. Weight = rating/SUM(family ratings) confirmed (BV over K17:K21+K24:K29, IT over K33:K46+K49:K51+K54:K60). Question counts 24 = 14+3+7 (IT rows 10–23, 26–28, 31–37) and 11 = 5+6 (Business rows 11–15, 18–23) confirmed. Stray empty SUM argument confirmed in L20 (absent in L17). |
| 3 | 4R thresholds & mapping | PASS | DCP E7=3, F7=2, G7=3, H7=2; named to c_Opt/c_Urg_* as documented. DCP!I21 formula matches the documented text exactly (Unknown when BV=0 or IT=0; `<`/`>=` boundaries exactly as stated — score = threshold counts as "high"). Spin-button VBA: E7/F7/G7/H7 ±0.1 clamped MIN(5)/MAX(0). Quadrant-count (row 12) and urgent-review (row 17) COUNTIFS match. |
| 4 | Filter cascade | PASS | FCP!L13 verbatim: Out of Scope → No Longer Utilized → Terminate → Replaced → In Flight → else W13 (disposition pass-through). O13 Analysis Candidate = "Y" only when no filter hits, else "N". Summary-count formulas (B6/D6/F6/J6/L6/N6) match. |
| 5 | Heat map rules | PASS | 'Heat Map'!J1=0.1, J3=0.26, J5=`=1-J3`; Heat Map Data!F3 `=IF(C3=0,"",IF(D3>ROUNDUP('Heat Map'!$J$1*C3,1),"Terminate",IF(E3>ROUNDUP(('Heat Map'!$J$3-'Heat Map'!$J$1)*C3,1),"Redesign","Retain")))` — strict `>`, ROUNDUP to 1 decimal, retool+redesign tested against J3−J1 = 16%. VBA generate_Heatmap colors confirmed: Terminate RGB(204,0,0)/white text, Redesign RGB(255,255,0)/black, Retain RGB(0,176,80)/white, else white. |
| 6 | Lookup lists | CORRECTED | Ratings2 = Lookup!B29:C34 (N/A=0…Very important=5) and SCORE15 = Lookup!D19:D23 = {1,2,3,4,5} confirmed via defined names + cell dump. Correction: doc listed "Ratings / Ratings2" as one range B29:C34; actually `Ratings` = B29:B34 (labels) and `Ratings2` = B29:C34 (map) — table row split. All other option lists spot-checked (lst_Disposition Y2:Y9, lst_Filter AF2:AF7, lst_YesNo D14:D15 = Y/N, YESNO = Yes/No, lkup_Final_Disposition AK2:AK5, lkup_MeetsFutureState AN2:AN4) — match. |
| 7 | VBA inventory (5 spot-checks) | PASS | generate_Heatmap (clear, rebuild/sort/dedupe tab_L1_Heatmap, paint via Select Case on Heat Map Data col F with the RGB values above); add_Capability (blank→"Level L0"/"Level L1", copy, sort, RemoveDuplicates ×3); mc_RefreshData_Disposition (Get_MDV_InScope, delete surplus rows, AutoFill C:I down, write App IDs; backup/restore machinery present but calls commented out); RefreshData_MissionCritical (depends on broken idx_DB_MC_HR/idx_DB_MC_AppID — both confirmed `#REF!`; insert/delete rows, AutoFill A:J); RefreshStatistics_MDV (Min/Max/Average/Median/Count over SpecialCells(xlCellTypeVisible); Mode written as "N/A" when FilterMode active). All as documented. |
| 8 | Dashboard KPIs & 4R chart | CORRECTED | All COUNTIFS KPI formulas match (disposition pie L11:L17, mission-critical Q10/Q11 testing "Y"/"<>Y", 2×2 matrix D13/F13/D18/F18, universe Q22/Q23, collection progress rows 33–35 incl. the 0.02 Demographics floor, score-distribution mirrors of Weightings CP E5:I5/E7:I7). 4R chart (chart5.xml): series X=DCP!$G$21:$G$1020, Y=DCP!$H$21:$H$1020 + threshold lines from '4R Framework'!C14:H15/C18:H19 — as documented. New finding added: Dashboard!K35 references lst_MDV_Completion_BV instead of _IT (quirk #19). |
| 9 | Finance | PASS | Sub Total rows D13/D22/D30/D37 confirmed empty (no formulas); D38 `=D37+D30+D22+D13` → always 0 in this copy; D53 `=D38/MAX($D$38:$AB$38)`. Matches doc incl. the defect note. |
| 10 | Ambiguity spot-checks (3 of 18) | PASS (1 count corrected) | (#14) `lst_MDV_IT_TR_VendorSupport_Platform` → 'Master Data View'!$AU$13:$AU$1014 where MDV!AU12 header = "Vendor Support - Database" (AV = Platform) — bug confirmed real. (#2) SCORE15 validation on all answer cells offers only 1–5, no "N/A" — confirmed. (#5) lst_YesNo = {Y,N} (Options!D14:D15) on MDV col U vs Lookup YESNO = {Yes,No}; Dashboard tests "Y" — mismatch confirmed real. Correction elsewhere: quirk #13's "#REF! names" count updated from ~80 to ~145 (actual count of workbook names containing #REF!). |

**Corrections applied (4):** (1) §2.1 MDV col U dropdown values "Yes/No" → "Y / N"; (2) §2.5 split Ratings (B29:B34) vs Ratings2 (B29:C34); (3) §8 + new quirk #19: Dashboard!K35 IT-completion copy-paste bug; (4) quirk #13 #REF!-name count ~80 → ~145. Everything else verified as accurate against the workbook.
