-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "authorMembershipId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "recipientMembershipId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Comment_id_engagementId_key" ON "Comment"("id", "engagementId");
CREATE INDEX "Comment_engagementId_applicationId_idx" ON "Comment"("engagementId", "applicationId");
CREATE UNIQUE INDEX "Notification_id_engagementId_key" ON "Notification"("id", "engagementId");
CREATE INDEX "Notification_engagementId_recipientMembershipId_readAt_idx" ON "Notification"("engagementId", "recipientMembershipId", "readAt");

-- AddForeignKey (composite same-engagement FKs per tenancy invariants)
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_applicationId_engagementId_fkey" FOREIGN KEY ("applicationId", "engagementId") REFERENCES "Application"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorMembershipId_engagementId_fkey" FOREIGN KEY ("authorMembershipId", "engagementId") REFERENCES "Membership"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_engagementId_fkey" FOREIGN KEY ("parentId", "engagementId") REFERENCES "Comment"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientMembershipId_engagementId_fkey" FOREIGN KEY ("recipientMembershipId", "engagementId") REFERENCES "Membership"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;
