/**
 * C3 verification against the live dev DB through ROLE-SCOPED clients —
 * exercises the same guard paths the server actions use.
 * Run: NODE_OPTIONS=--conditions=react-server npx tsx prisma/verify-c3.ts
 */
import { adminDb } from "../src/lib/db/admin";
import { getScopedDb } from "../src/lib/db/scoped";
import type { GuardContext } from "../src/lib/db/guard";

type ScopedCtx = Parameters<typeof getScopedDb>[0];

const ENG = "cmrot35z70000d6vbtk7s2xfo";

async function main() {
  const admin = adminDb();
  const members = await admin.membership.findMany({ where: { engagementId: ENG } });
  const byRole = (r: string) => {
    const m = members.find((m) => m.role === r);
    if (!m) throw new Error(`no ${r} membership`);
    return m;
  };
  const ctx = (role: GuardContext["role"]): ScopedCtx => ({
    engagementId: ENG,
    membershipId: byRole(role).id,
    role,
    readOnly: false,
    clerkUserId: byRole(role).clerkUserId ?? `verify:${role}`,
    actorDisplay: byRole(role).displayName ?? role,
  });
  const lead = getScopedDb(ctx("ENGAGEMENT_LEAD"));
  const viewer = getScopedDb(ctx("CLIENT_VIEWER"));
  const respondent = getScopedDb(ctx("CLIENT_RESPONDENT"));

  const payroll = await lead.capabilityNode.findFirst({ where: { name: "Payroll" } });
  if (!payroll) throw new Error("Payroll node missing");

  // 1. Capability comments: one internal, one shared (lead-authored).
  const internal = await lead.comment.create({
    data: { engagementId: ENG, capabilityNodeId: payroll.id, applicationId: null, authorMembershipId: byRole("ENGAGEMENT_LEAD").id, parentId: null, body: "[c3-test] internal note", internal: true },
  });
  const shared = await lead.comment.create({
    data: { engagementId: ENG, capabilityNodeId: payroll.id, applicationId: null, authorMembershipId: byRole("ENGAGEMENT_LEAD").id, parentId: null, body: "[c3-test] shared with client", internal: false },
  });

  // 2. Viewer sees ONLY the shared capability comment.
  const viewerSees = await viewer.comment.findMany({ where: { capabilityNodeId: payroll.id } });
  console.log("viewer capability comments:", viewerSees.map((c) => `${c.internal ? "INTERNAL" : "shared"}:${c.body}`));
  if (viewerSees.some((c) => c.internal)) throw new Error("FAIL: viewer saw an internal capability comment");
  if (!viewerSees.some((c) => c.id === shared.id)) throw new Error("FAIL: viewer missing the shared comment");

  // 3. XOR check: a comment with BOTH targets must be rejected by the DB.
  const someApp = await lead.application.findFirst({ where: {}, select: { id: true } });
  let xorRejected = false;
  try {
    await lead.comment.create({
      data: { engagementId: ENG, capabilityNodeId: payroll.id, applicationId: someApp!.id, authorMembershipId: byRole("ENGAGEMENT_LEAD").id, parentId: null, body: "[c3-test] both targets", internal: true },
    });
  } catch {
    xorRejected = true;
  }
  console.log("XOR check rejected dual-target comment:", xorRejected);
  if (!xorRejected) throw new Error("FAIL: dual-target comment was accepted");

  // 4. Respondent cannot read capability comments or sign-offs.
  let respondentDenied = 0;
  try { await respondent.comment.findMany({}); } catch { respondentDenied++; }
  try { await respondent.dispositionSignOff.findMany({}); } catch { respondentDenied++; }
  console.log("respondent denied (comments + signoffs):", respondentDenied === 2);
  if (respondentDenied !== 2) throw new Error("FAIL: respondent access not fully denied");

  // 5. Sign-off: record for an app with a known disposition, viewer can read it.
  const scored = await lead.application.findFirst({
    where: { result: { isNot: null } },
    include: { result: { select: { computedDisposition: true } }, override: { select: { disposition: true } } },
  });
  if (!scored) throw new Error("no scored application");
  const final = scored.override?.disposition ?? scored.result!.computedDisposition;
  const so = await lead.dispositionSignOff.upsert({
    where: { applicationId_engagementId: { applicationId: scored.id, engagementId: ENG } },
    create: { engagementId: ENG, applicationId: scored.id, disposition: final, signedByMembershipId: byRole("ENGAGEMENT_LEAD").id, note: "[c3-test]" },
    update: { disposition: final, signedByMembershipId: byRole("ENGAGEMENT_LEAD").id, note: "[c3-test]" },
  });
  console.log(`sign-off recorded: ${scored.name} @ ${so.disposition}`);
  const viewerSignOff = await viewer.dispositionSignOff.findMany({ where: { applicationId: scored.id } });
  console.log("viewer reads sign-off:", viewerSignOff.length === 1);
  if (viewerSignOff.length !== 1) throw new Error("FAIL: viewer cannot read sign-off");

  // 6. Viewer cannot WRITE sign-offs.
  let viewerWriteDenied = false;
  try {
    await viewer.dispositionSignOff.delete({ where: { id: so.id } });
  } catch { viewerWriteDenied = true; }
  console.log("viewer sign-off write denied:", viewerWriteDenied);
  if (!viewerWriteDenied) throw new Error("FAIL: viewer deleted a sign-off");

  // Cleanup test rows.
  await lead.comment.deleteMany({ where: { body: { startsWith: "[c3-test]" } } });
  await lead.dispositionSignOff.delete({ where: { id: so.id } });
  console.log("cleanup done — internal comment id was", internal.id);
  console.log("\nALL C3 CHECKS PASSED");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await adminDb().$disconnect(); });
