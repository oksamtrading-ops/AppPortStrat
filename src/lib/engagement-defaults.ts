/**
 * Per-engagement configuration defaults (APP-SPEC §4.1, §4.5; inventory §2.5, §3.1).
 * Pure constants — safe to import anywhere (server actions, provisioning, seeds).
 */

export interface OptionListSeed {
  key: string;
  name: string;
  values: readonly string[];
}

/**
 * Option lists pre-seeded into every new engagement (workbook defaults,
 * inventory §2.5). All editable per engagement. `actionPlanAssignment` is the
 * client-specific legacy list shipped as an EDITABLE EXAMPLE, not a default
 * recommendation (spec §4.1).
 */
export const DEFAULT_OPTION_LISTS: readonly OptionListSeed[] = [
  { key: "applicationType", name: "Application Types", values: [] },
  {
    key: "actionPlanAssignment",
    name: "Action Plan Assignment (example)",
    values: [
      "N/A",
      "Not in Future State",
      "00 - Keep",
      "01 - No Longer Utilized",
      "02 - Terminate",
      "03 - Mainframe",
      "04 - Databases Not In Future State",
      "05 - PowerBuilder",
      "06 - ERP/CAPPS",
      "07 - Possible ERP",
      "08 - Consolidation - Compass",
      "09 - Consolidation - Vehicle Scheduling",
      "10 - Consolidation - Facilities Scheduling",
      "11 - Consolidation - Facilities Security",
      "12 - Reporting",
      "13 - Project Management",
      "14 - Consolidation - Bridge Design",
      "15 - Consolidation - ELS",
      "16 - Consolidation - TxDOT EDMS",
      "17 - Consolidation - ROW",
      "18 - Consolidation - Miscellaneous",
      "19 - Consolidation - Geospatial Inventory",
      "Maybe ERP or COTS incident tracking",
    ],
  },
  { key: "customization", name: "Level of Customization", values: ["Low", "Medium", "High"] },
  { key: "applicationSize", name: "Application Size", values: ["Small", "Medium", "Large"] },
  { key: "imrStatus", name: "IMR Status", values: ["Invest", "Maintain", "Retire"] },
  {
    key: "usageTimeframe",
    name: "Usage Timeframe",
    values: ["24x7", "Business hours", "Business hours + weekends", "Off-hours only", "Other"],
  },
  {
    key: "accessFrequency",
    name: "Access Frequency",
    values: ["Daily", "Weekly", "Monthly", "Quarterly", "Annually", "Sporadically"],
  },
  { key: "criticality", name: "Criticality", values: ["Sensitive", "Non-Critical", "Critical", "Vital"] },
  { key: "hardwarePlatform", name: "Hardware Platform", values: ["Mainframe", "Mid-Range", "Server", "VAX"] },
  {
    key: "operatingSystem",
    name: "Operating System",
    values: ["AIX", "NCR UNIX", "SUN UNIX", "VMS", "Windows NT"],
  },
  {
    key: "databaseVendor",
    name: "Database Vendor",
    values: ["Informix", "MS SQL", "Oracle", "Progress", "RDB", "Sybase", "Teradata", "UDB"],
  },
] as const;

/**
 * The "APS 5.0 sample config" weighting preset — the project-specific setting
 * found in this workbook copy (inventory §3.1, verified): the listed questions
 * "Very important" (5), every other question in the family N/A (0).
 * BV → 2 × 0.5; IT → 10 × 0.1.
 */
export const APS50_PRESET = {
  bv: ["BV_SI_BUS_UNITS", "BV_SI_IMPORTANCE_BU"],
  it: [
    "IT_TC_AVAILABILITY",
    "IT_TC_SUPPORT_VOLUME",
    "IT_TC_SCALABILITY",
    "IT_TC_ADAPTABILITY",
    "IT_AI_COMPLEXITY",
    "IT_TR_DR_CRITICALITY",
    "IT_TR_VENDOR_PLATFORM",
    "IT_TR_VENDOR_INTEGRATION",
    "IT_TR_SECURITY",
    "IT_TR_SPECIALIZED_KNOWLEDGE",
  ],
} as const;

/** Importance rating every question starts at (tool-neutral default): "Normal". */
export const DEFAULT_IMPORTANCE_RATING = 2;

export const THRESHOLD_DEFAULTS = {
  optBv: 3.0,
  urgBv: 2.0,
  optIt: 3.0,
  urgIt: 2.0,
  heatT1: 0.1,
  heatT2: 0.26,
} as const;
