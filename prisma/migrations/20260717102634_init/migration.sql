-- CreateEnum
CREATE TYPE "EngagementStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'PENDING_PURGE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ENGAGEMENT_LEAD', 'CONSULTANT', 'CLIENT_RESPONDENT', 'CLIENT_VIEWER');

-- CreateEnum
CREATE TYPE "CapabilityLevel" AS ENUM ('L0', 'L1', 'L2');

-- CreateEnum
CREATE TYPE "SurveyType" AS ENUM ('DEMOGRAPHICS', 'IT_HEALTH', 'BUSINESS_VALUE', 'FINANCE');

-- CreateEnum
CREATE TYPE "ScoreFamily" AS ENUM ('BUSINESS', 'IT', 'IT_NON_REPORT', 'NONE');

-- CreateEnum
CREATE TYPE "AnswerKind" AS ENUM ('SCORE_1_5', 'TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'BOOLEAN', 'OPTION');

-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE');

-- CreateEnum
CREATE TYPE "Disposition" AS ENUM ('UNKNOWN', 'REDESIGN', 'KEEP_AS_IS', 'TERMINATE', 'RETOOL');

-- CreateEnum
CREATE TYPE "FilterHit" AS ENUM ('OUT_OF_SCOPE', 'NO_LONGER_UTILIZED', 'TERMINATE', 'REPLACED', 'IN_FLIGHT');

-- CreateEnum
CREATE TYPE "MeetsFutureState" AS ENUM ('YES', 'NO', 'PARTIAL');

-- CreateEnum
CREATE TYPE "CostVersionType" AS ENUM ('ACTUAL', 'BUDGET', 'FORECAST');

-- CreateTable
CREATE TABLE "Engagement" (
    "id" TEXT NOT NULL,
    "clerkOrgId" TEXT,
    "name" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "status" "EngagementStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fiscalYearConvention" TEXT NOT NULL DEFAULT 'FY',
    "strictWorkbookScoring" BOOLEAN NOT NULL DEFAULT false,
    "splitHeatmapYellow" BOOLEAN NOT NULL DEFAULT false,
    "dispositionLabels" JSONB,
    "configVersion" INTEGER NOT NULL DEFAULT 0,
    "purgeScheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "clerkUserId" TEXT,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "Role" NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTemplate" (
    "id" TEXT NOT NULL,
    "type" "SurveyType" NOT NULL,
    "name" TEXT NOT NULL,
    "bankVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BankTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankQuestion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "description" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "scoreFamily" "ScoreFamily" NOT NULL,
    "answerKind" "AnswerKind" NOT NULL,
    "optionListKey" TEXT,
    "legacyRef" TEXT,

    CONSTRAINT "BankQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAnchor" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "BankAnchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyTemplate" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "type" "SurveyType" NOT NULL,
    "name" TEXT NOT NULL,
    "bankVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SurveyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyQuestion" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "description" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "scoreFamily" "ScoreFamily" NOT NULL,
    "answerKind" "AnswerKind" NOT NULL,
    "optionListKey" TEXT,
    "legacyRef" TEXT,

    CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuidelineAnchor" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "GuidelineAnchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionWeighting" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "importanceRating" INTEGER NOT NULL DEFAULT 2,

    CONSTRAINT "QuestionWeighting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThresholdConfig" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "optBv" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    "urgBv" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "optIt" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    "urgIt" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "heatT1" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "heatT2" DOUBLE PRECISION NOT NULL DEFAULT 0.26,

    CONSTRAINT "ThresholdConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "appNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "acronym" TEXT,
    "description" TEXT,
    "applicationType" TEXT,
    "businessFunctionDetail" TEXT,
    "target" TEXT,
    "meetsFutureState" "MeetsFutureState",
    "actionPlanAssignment" TEXT,
    "actionPlanJustification" TEXT,
    "missionCritical" BOOLEAN NOT NULL DEFAULT false,
    "comments" TEXT,
    "inScope" BOOLEAN NOT NULL DEFAULT true,
    "isUtilized" BOOLEAN NOT NULL DEFAULT true,
    "isReplaced" BOOLEAN NOT NULL DEFAULT false,
    "inFlight" BOOLEAN NOT NULL DEFAULT false,
    "capabilityNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityNode" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "parentId" TEXT,
    "level" "CapabilityLevel" NOT NULL,
    "name" TEXT NOT NULL,
    "isPlaceholder" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CapabilityNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyAssignment" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" "SurveyStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "isNA" BOOLEAN NOT NULL DEFAULT false,
    "numericValue" DOUBLE PRECISION,
    "textValue" TEXT,
    "boolValue" BOOLEAN,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispositionResult" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "itScore" DOUBLE PRECISION,
    "bvScore" DOUBLE PRECISION,
    "itPartial" BOOLEAN NOT NULL DEFAULT false,
    "bvPartial" BOOLEAN NOT NULL DEFAULT false,
    "itNonReportScore" DOUBLE PRECISION,
    "financialScore" DOUBLE PRECISION,
    "computedDisposition" "Disposition" NOT NULL DEFAULT 'UNKNOWN',
    "filterHit" "FilterHit",
    "analysisCandidate" BOOLEAN NOT NULL DEFAULT false,
    "veryLowBv" BOOLEAN NOT NULL DEFAULT false,
    "veryLowIt" BOOLEAN NOT NULL DEFAULT false,
    "configVersion" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispositionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispositionOverride" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "disposition" "Disposition" NOT NULL,
    "justification" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispositionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostRecord" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "versionType" "CostVersionType" NOT NULL,
    "category" TEXT NOT NULL,
    "lineItem" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "CostRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionList" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "OptionList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionItem" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "optionListId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "OptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorDisplay" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_clerkOrgId_key" ON "Engagement"("clerkOrgId");

-- CreateIndex
CREATE INDEX "Membership_engagementId_idx" ON "Membership"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_id_engagementId_key" ON "Membership"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_engagementId_email_key" ON "Membership"("engagementId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_engagementId_clerkUserId_key" ON "Membership"("engagementId", "clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "BankTemplate_type_key" ON "BankTemplate"("type");

-- CreateIndex
CREATE UNIQUE INDEX "BankQuestion_templateId_code_key" ON "BankQuestion"("templateId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BankAnchor_questionId_value_key" ON "BankAnchor"("questionId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyTemplate_id_engagementId_key" ON "SurveyTemplate"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyTemplate_engagementId_type_key" ON "SurveyTemplate"("engagementId", "type");

-- CreateIndex
CREATE INDEX "SurveyQuestion_engagementId_idx" ON "SurveyQuestion"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyQuestion_id_engagementId_key" ON "SurveyQuestion"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyQuestion_templateId_code_key" ON "SurveyQuestion"("templateId", "code");

-- CreateIndex
CREATE INDEX "GuidelineAnchor_engagementId_idx" ON "GuidelineAnchor"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "GuidelineAnchor_id_engagementId_key" ON "GuidelineAnchor"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "GuidelineAnchor_questionId_value_key" ON "GuidelineAnchor"("questionId", "value");

-- CreateIndex
CREATE INDEX "QuestionWeighting_engagementId_idx" ON "QuestionWeighting"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionWeighting_id_engagementId_key" ON "QuestionWeighting"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionWeighting_questionId_engagementId_key" ON "QuestionWeighting"("questionId", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "ThresholdConfig_engagementId_key" ON "ThresholdConfig"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "ThresholdConfig_id_engagementId_key" ON "ThresholdConfig"("id", "engagementId");

-- CreateIndex
CREATE INDEX "Application_engagementId_idx" ON "Application"("engagementId");

-- CreateIndex
CREATE INDEX "Application_capabilityNodeId_idx" ON "Application"("capabilityNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_id_engagementId_key" ON "Application"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_engagementId_appNumber_key" ON "Application"("engagementId", "appNumber");

-- CreateIndex
CREATE INDEX "CapabilityNode_engagementId_idx" ON "CapabilityNode"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityNode_id_engagementId_key" ON "CapabilityNode"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityNode_engagementId_parentId_name_key" ON "CapabilityNode"("engagementId", "parentId", "name");

-- CreateIndex
CREATE INDEX "SurveyAssignment_engagementId_idx" ON "SurveyAssignment"("engagementId");

-- CreateIndex
CREATE INDEX "SurveyAssignment_membershipId_idx" ON "SurveyAssignment"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyAssignment_id_engagementId_key" ON "SurveyAssignment"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyAssignment_applicationId_templateId_membershipId_key" ON "SurveyAssignment"("applicationId", "templateId", "membershipId");

-- CreateIndex
CREATE INDEX "SurveyResponse_engagementId_idx" ON "SurveyResponse"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_id_engagementId_key" ON "SurveyResponse"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_applicationId_templateId_key" ON "SurveyResponse"("applicationId", "templateId");

-- CreateIndex
CREATE INDEX "Answer_engagementId_idx" ON "Answer"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_id_engagementId_key" ON "Answer"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_responseId_questionId_key" ON "Answer"("responseId", "questionId");

-- CreateIndex
CREATE INDEX "DispositionResult_engagementId_idx" ON "DispositionResult"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "DispositionResult_id_engagementId_key" ON "DispositionResult"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "DispositionResult_applicationId_engagementId_key" ON "DispositionResult"("applicationId", "engagementId");

-- CreateIndex
CREATE INDEX "DispositionOverride_engagementId_idx" ON "DispositionOverride"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "DispositionOverride_id_engagementId_key" ON "DispositionOverride"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "DispositionOverride_applicationId_engagementId_key" ON "DispositionOverride"("applicationId", "engagementId");

-- CreateIndex
CREATE INDEX "CostRecord_engagementId_idx" ON "CostRecord"("engagementId");

-- CreateIndex
CREATE INDEX "CostRecord_applicationId_fiscalYear_versionType_idx" ON "CostRecord"("applicationId", "fiscalYear", "versionType");

-- CreateIndex
CREATE UNIQUE INDEX "CostRecord_id_engagementId_key" ON "CostRecord"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "OptionList_id_engagementId_key" ON "OptionList"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "OptionList_engagementId_key_key" ON "OptionList"("engagementId", "key");

-- CreateIndex
CREATE INDEX "OptionItem_engagementId_idx" ON "OptionItem"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "OptionItem_id_engagementId_key" ON "OptionItem"("id", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "OptionItem_optionListId_value_key" ON "OptionItem"("optionListId", "value");

-- CreateIndex
CREATE INDEX "AuditEvent_engagementId_createdAt_idx" ON "AuditEvent"("engagementId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_id_engagementId_key" ON "AuditEvent"("id", "engagementId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankQuestion" ADD CONSTRAINT "BankQuestion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "BankTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAnchor" ADD CONSTRAINT "BankAnchor_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "BankQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyTemplate" ADD CONSTRAINT "SurveyTemplate_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_templateId_engagementId_fkey" FOREIGN KEY ("templateId", "engagementId") REFERENCES "SurveyTemplate"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidelineAnchor" ADD CONSTRAINT "GuidelineAnchor_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidelineAnchor" ADD CONSTRAINT "GuidelineAnchor_questionId_engagementId_fkey" FOREIGN KEY ("questionId", "engagementId") REFERENCES "SurveyQuestion"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionWeighting" ADD CONSTRAINT "QuestionWeighting_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionWeighting" ADD CONSTRAINT "QuestionWeighting_questionId_engagementId_fkey" FOREIGN KEY ("questionId", "engagementId") REFERENCES "SurveyQuestion"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThresholdConfig" ADD CONSTRAINT "ThresholdConfig_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityNode" ADD CONSTRAINT "CapabilityNode_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityNode" ADD CONSTRAINT "CapabilityNode_parentId_engagementId_fkey" FOREIGN KEY ("parentId", "engagementId") REFERENCES "CapabilityNode"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAssignment" ADD CONSTRAINT "SurveyAssignment_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAssignment" ADD CONSTRAINT "SurveyAssignment_applicationId_engagementId_fkey" FOREIGN KEY ("applicationId", "engagementId") REFERENCES "Application"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAssignment" ADD CONSTRAINT "SurveyAssignment_templateId_engagementId_fkey" FOREIGN KEY ("templateId", "engagementId") REFERENCES "SurveyTemplate"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAssignment" ADD CONSTRAINT "SurveyAssignment_membershipId_engagementId_fkey" FOREIGN KEY ("membershipId", "engagementId") REFERENCES "Membership"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_applicationId_engagementId_fkey" FOREIGN KEY ("applicationId", "engagementId") REFERENCES "Application"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_templateId_engagementId_fkey" FOREIGN KEY ("templateId", "engagementId") REFERENCES "SurveyTemplate"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_responseId_engagementId_fkey" FOREIGN KEY ("responseId", "engagementId") REFERENCES "SurveyResponse"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_engagementId_fkey" FOREIGN KEY ("questionId", "engagementId") REFERENCES "SurveyQuestion"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispositionResult" ADD CONSTRAINT "DispositionResult_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispositionResult" ADD CONSTRAINT "DispositionResult_applicationId_engagementId_fkey" FOREIGN KEY ("applicationId", "engagementId") REFERENCES "Application"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispositionOverride" ADD CONSTRAINT "DispositionOverride_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispositionOverride" ADD CONSTRAINT "DispositionOverride_applicationId_engagementId_fkey" FOREIGN KEY ("applicationId", "engagementId") REFERENCES "Application"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_applicationId_engagementId_fkey" FOREIGN KEY ("applicationId", "engagementId") REFERENCES "Application"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionList" ADD CONSTRAINT "OptionList_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionItem" ADD CONSTRAINT "OptionItem_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionItem" ADD CONSTRAINT "OptionItem_optionListId_engagementId_fkey" FOREIGN KEY ("optionListId", "engagementId") REFERENCES "OptionList"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
