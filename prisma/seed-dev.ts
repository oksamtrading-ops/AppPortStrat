/**
 * DEV-ONLY seed: sample engagement + dev identities for the cookie user
 * switcher. Gated by the same fail-closed triple check as dev auth — it will
 * refuse to run on Vercel, in CI, or without ALLOW_DEV_AUTH=true, so dev
 * identities can never land in a shared/production database by accident.
 *
 * Run AFTER npm run db:seed (needs the question bank).
 */
import { resolveAuthMode, readAuthEnv } from "../src/lib/auth/mode";
import { DEV_USERS } from "../src/lib/auth/dev";
import { createEngagementWithConfig } from "../src/lib/db/provision";
import { getRawPrisma } from "../src/lib/db/prisma";

async function main() {
  let mode: string;
  try {
    mode = resolveAuthMode(readAuthEnv());
  } catch (err) {
    console.error(`Refusing to seed dev identities: ${(err as Error).message}`);
    process.exit(1);
  }
  if (mode !== "dev") {
    console.error("Refusing to seed dev identities: auth mode is not 'dev' (Clerk keys are configured).");
    process.exit(1);
  }

  const db = getRawPrisma();

  const existing = await db.engagement.findFirst({ where: { name: "Sample Engagement (Dev)" } });
  if (existing) {
    console.log("Sample engagement already exists — skipping.");
    return;
  }

  const engagement = await createEngagementWithConfig({
    name: "Sample Engagement (Dev)",
    clientName: "Sample Client Co.",
    source: { kind: "defaults", preset: "NEUTRAL" },
  });
  console.log(`Created engagement ${engagement.id}`);

  // Dev identities → memberships (role per user).
  const roleByDevUser: Record<string, "ENGAGEMENT_LEAD" | "CONSULTANT" | "CLIENT_RESPONDENT" | "CLIENT_VIEWER"> = {
    "dev:admin": "ENGAGEMENT_LEAD",
    "dev:lead": "ENGAGEMENT_LEAD",
    "dev:consultant": "CONSULTANT",
    "dev:respondent": "CLIENT_RESPONDENT",
    "dev:viewer": "CLIENT_VIEWER",
  };
  const memberships = new Map<string, string>();
  for (const user of DEV_USERS) {
    const m = await db.membership.create({
      data: {
        engagementId: engagement.id,
        clerkUserId: user.id,
        email: user.email,
        displayName: user.displayName,
        role: roleByDevUser[user.id],
      },
    });
    memberships.set(user.id, m.id);
  }

  // Small capability tree.
  const l0 = await db.capabilityNode.create({
    data: { engagementId: engagement.id, level: "L0", name: "Enterprise Operations" },
  });
  const l1Names = ["Finance", "Human Resources", "Information Technology", "Sales & Service"];
  const l2ByL1: Record<string, string[]> = {
    Finance: ["General Ledger", "Accounts Payable"],
    "Human Resources": ["Payroll", "Talent Management"],
    "Information Technology": ["Infrastructure", "Service Desk"],
    "Sales & Service": ["CRM", "Order Management"],
  };
  const l2Nodes: { id: string; name: string }[] = [];
  for (const l1Name of l1Names) {
    const l1 = await db.capabilityNode.create({
      data: { engagementId: engagement.id, parentId: l0.id, level: "L1", name: l1Name },
    });
    for (const l2Name of l2ByL1[l1Name]) {
      const l2 = await db.capabilityNode.create({
        data: { engagementId: engagement.id, parentId: l1.id, level: "L2", name: l2Name },
      });
      l2Nodes.push({ id: l2.id, name: l2Name });
    }
  }

  // Sample applications with scope-flag variety.
  const apps: Array<{
    name: string;
    acronym: string;
    l2: string;
    missionCritical?: boolean;
    inScope?: boolean;
    isUtilized?: boolean;
    isReplaced?: boolean;
    inFlight?: boolean;
  }> = [
    { name: "General Ledger System", acronym: "GLS", l2: "General Ledger", missionCritical: true },
    { name: "Invoice Processing Portal", acronym: "IPP", l2: "Accounts Payable" },
    { name: "Payroll Engine", acronym: "PAY", l2: "Payroll", missionCritical: true },
    { name: "Talent Tracker", acronym: "TLT", l2: "Talent Management" },
    { name: "Legacy Service Desk", acronym: "LSD", l2: "Service Desk", isReplaced: true },
    { name: "CRM Platform", acronym: "CRM", l2: "CRM", missionCritical: true },
    { name: "Order Hub (New)", acronym: "OHN", l2: "Order Management", inFlight: true },
    { name: "Retired Reporting Tool", acronym: "RRT", l2: "Infrastructure", isUtilized: false },
    { name: "Shadow Spreadsheet Suite", acronym: "SSS", l2: "Infrastructure", inScope: false },
  ];
  const appIds: string[] = [];
  let appNumber = 1;
  for (const a of apps) {
    const app = await db.application.create({
      data: {
        engagementId: engagement.id,
        appNumber: appNumber++,
        name: a.name,
        acronym: a.acronym,
        missionCritical: a.missionCritical ?? false,
        inScope: a.inScope ?? true,
        isUtilized: a.isUtilized ?? true,
        isReplaced: a.isReplaced ?? false,
        inFlight: a.inFlight ?? false,
        capabilityNodeId: l2Nodes.find((n) => n.name === a.l2)?.id ?? null,
      },
    });
    appIds.push(app.id);
  }

  // Sample survey answers for the first four apps (deterministic pattern).
  const templates = await db.surveyTemplate.findMany({
    where: { engagementId: engagement.id, type: { in: ["IT_HEALTH", "BUSINESS_VALUE"] } },
    include: { questions: { where: { scoreFamily: { in: ["IT", "BUSINESS", "IT_NON_REPORT"] } } } },
  });
  const consultantMembershipId = memberships.get("dev:consultant")!;
  for (let i = 0; i < 4; i++) {
    const applicationId = appIds[i];
    for (const template of templates) {
      const response = await db.surveyResponse.create({
        data: {
          engagementId: engagement.id,
          applicationId,
          templateId: template.id,
          status: "COMPLETE",
          updatedById: consultantMembershipId,
        },
      });
      let q = 0;
      for (const question of template.questions) {
        // Deterministic spread of 1–5 that differs per app.
        const value = ((i * 7 + q * 3) % 5) + 1;
        await db.answer.create({
          data: {
            engagementId: engagement.id,
            responseId: response.id,
            questionId: question.id,
            numericValue: value,
          },
        });
        q++;
      }
    }
  }

  // Respondent assignments: IT + BV surveys for two apps.
  const respondentMembershipId = memberships.get("dev:respondent")!;
  for (const template of templates) {
    for (const applicationId of appIds.slice(4, 6)) {
      await db.surveyAssignment.create({
        data: {
          engagementId: engagement.id,
          applicationId,
          templateId: template.id,
          membershipId: respondentMembershipId,
        },
      });
    }
  }

  console.log(`Seeded ${apps.length} applications, sample answers for 4, assignments for the dev respondent.`);
  console.log("Run a recompute (save weightings/thresholds in the UI) to populate scores and dispositions.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await getRawPrisma().$disconnect();
  });
