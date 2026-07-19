-- CreateTable
CREATE TABLE "EngagementTombstone" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "engagementName" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "deletedByUserId" TEXT NOT NULL,
    "deletedByDisplay" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counts" JSONB,

    CONSTRAINT "EngagementTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "bucket" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowEnd" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("bucket")
);

-- CreateIndex
CREATE INDEX "EngagementTombstone_deletedAt_idx" ON "EngagementTombstone"("deletedAt");

-- CreateIndex
CREATE INDEX "RateLimitHit_windowEnd_idx" ON "RateLimitHit"("windowEnd");
