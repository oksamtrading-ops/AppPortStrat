-- AlterTable: refinement description + reference-library provenance
ALTER TABLE "CapabilityNode" ADD COLUMN "description" TEXT;
ALTER TABLE "CapabilityNode" ADD COLUMN "sourceLibraryId" TEXT;
ALTER TABLE "CapabilityNode" ADD COLUMN "sourceCode" TEXT;

-- CreateTable
CREATE TABLE "CapabilityLibrary" (
    "id" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "attribution" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "CapabilityLibrary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityLibraryNode" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "parentId" TEXT,
    "level" "CapabilityLevel" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CapabilityLibraryNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityLibrary_industry_name_version_key" ON "CapabilityLibrary"("industry", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityLibraryNode_libraryId_code_key" ON "CapabilityLibraryNode"("libraryId", "code");

-- CreateIndex
CREATE INDEX "CapabilityLibraryNode_libraryId_idx" ON "CapabilityLibraryNode"("libraryId");

-- AddForeignKey
ALTER TABLE "CapabilityLibraryNode" ADD CONSTRAINT "CapabilityLibraryNode_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "CapabilityLibrary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityLibraryNode" ADD CONSTRAINT "CapabilityLibraryNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CapabilityLibraryNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
