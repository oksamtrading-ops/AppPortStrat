/**
 * Sync every engagement's survey templates to the current question bank.
 * Additive only (see syncEngagementFromBank). Run after `npm run db:seed`
 * whenever the bank version changes: npm run db:sync-bank
 */
import "dotenv/config";
import { getRawPrisma } from "../src/lib/db/prisma";
import { syncEngagementFromBank } from "../src/lib/db/provision";

async function main() {
  const db = getRawPrisma();
  const engagements = await db.engagement.findMany({ select: { id: true, name: true } });
  for (const engagement of engagements) {
    const { addedQuestions } = await syncEngagementFromBank(engagement.id);
    console.log(`${engagement.name}: +${addedQuestions} questions`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await getRawPrisma().$disconnect();
  });
