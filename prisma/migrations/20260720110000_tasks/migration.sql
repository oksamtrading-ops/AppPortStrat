-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE');

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "applicationId" TEXT,
    "title" TEXT NOT NULL,
    "assigneeMembershipId" TEXT,
    "createdByMembershipId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Task_id_engagementId_key" ON "Task"("id", "engagementId");
CREATE INDEX "Task_engagementId_assigneeMembershipId_status_idx" ON "Task"("engagementId", "assigneeMembershipId", "status");
CREATE INDEX "Task_engagementId_applicationId_idx" ON "Task"("engagementId", "applicationId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_applicationId_engagementId_fkey" FOREIGN KEY ("applicationId", "engagementId") REFERENCES "Application"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeMembershipId_engagementId_fkey" FOREIGN KEY ("assigneeMembershipId", "engagementId") REFERENCES "Membership"("id", "engagementId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByMembershipId_engagementId_fkey" FOREIGN KEY ("createdByMembershipId", "engagementId") REFERENCES "Membership"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;
