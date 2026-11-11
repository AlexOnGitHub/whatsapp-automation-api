-- CreateEnum
CREATE TYPE "IntegrationJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationJobType" AS ENUM ('GOOGLE_CALENDAR_CREATE', 'GOOGLE_CALENDAR_UPDATE', 'GOOGLE_CALENDAR_DELETE', 'GOOGLE_SHEETS_APPEND', 'GOOGLE_SHEETS_UPDATE');

-- CreateTable
CREATE TABLE "IntegrationJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "jobType" "IntegrationJobType" NOT NULL,
    "status" "IntegrationJobStatus" NOT NULL DEFAULT 'PENDING',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB,
    "correlationId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationJob_status_nextAttemptAt_idx" ON "IntegrationJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "IntegrationJob_businessId_status_idx" ON "IntegrationJob"("businessId", "status");

-- CreateIndex
CREATE INDEX "IntegrationJob_businessId_entityType_entityId_idx" ON "IntegrationJob"("businessId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "IntegrationJob_jobType_status_idx" ON "IntegrationJob"("jobType", "status");

-- CreateIndex
CREATE INDEX "IntegrationJob_createdAt_idx" ON "IntegrationJob"("createdAt");

-- AddForeignKey
ALTER TABLE "IntegrationJob" ADD CONSTRAINT "IntegrationJob_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
