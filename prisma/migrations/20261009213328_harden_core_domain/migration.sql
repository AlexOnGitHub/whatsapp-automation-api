/*
  Warnings:

  - You are about to drop the column `credentials` on the `Integration` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[businessId,provider,integrationType]` on the table `Integration` will be added. If there are existing duplicate values, this will fail.
  - Made the column `conversationId` on table `ConversationSession` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `updatedAt` to the `Message` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "ErrorSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- DropForeignKey
ALTER TABLE "ConversationSession" DROP CONSTRAINT "ConversationSession_conversationId_fkey";

-- DropIndex
DROP INDEX "Integration_businessId_provider_integrationType_idx";

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "noShowAt" TIMESTAMP(3),
ADD COLUMN     "rescheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Business" ALTER COLUMN "timezone" SET DEFAULT 'America/Mexico_City';

-- AlterTable
ALTER TABLE "BusinessConfig" ADD COLUMN     "currencyCode" TEXT NOT NULL DEFAULT 'MXN',
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'es-MX';

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "closedReason" TEXT;

-- AlterTable
ALTER TABLE "ConversationSession" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "expiredAt" TIMESTAMP(3),
ADD COLUMN     "flowVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "conversationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "CustomerRequest" ADD COLUMN     "inReviewAt" TIMESTAMP(3),
ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ErrorLog" ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "severity" "ErrorSeverity" NOT NULL DEFAULT 'ERROR';

-- AlterTable
ALTER TABLE "HumanHandoff" ADD COLUMN     "assignedTo" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Integration" DROP COLUMN "credentials",
ADD COLUMN     "credentialsEncrypted" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InteractionLog" ADD COLUMN     "correlationId" TEXT;

-- AlterTable
ALTER TABLE "Message"
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "deliveryStatus" "MessageDeliveryStatus",
ADD COLUMN "failedAt" TIMESTAMP(3),
ADD COLUMN "failureCode" TEXT,
ADD COLUMN "failureReason" TEXT,
ADD COLUMN "providerTimestamp" TIMESTAMP(3),
ADD COLUMN "queuedAt" TIMESTAMP(3),
ADD COLUMN "readAt" TIMESTAMP(3),
ADD COLUMN "receivedAt" TIMESTAMP(3),
ADD COLUMN "sentAt" TIMESTAMP(3),
ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Backfill
UPDATE "Message"
SET "updatedAt" = "createdAt"
WHERE "updatedAt" IS NULL;

-- Enforce required column after backfill
ALTER TABLE "Message"
ALTER COLUMN "updatedAt" SET NOT NULL;

-- CreateTable
CREATE TABLE "MessageStatusEvent" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "status" "MessageDeliveryStatus" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "rawPayload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageStatusEvent_messageId_occurredAt_idx" ON "MessageStatusEvent"("messageId", "occurredAt");

-- CreateIndex
CREATE INDEX "MessageStatusEvent_status_occurredAt_idx" ON "MessageStatusEvent"("status", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageStatusEvent_messageId_status_occurredAt_key" ON "MessageStatusEvent"("messageId", "status", "occurredAt");

-- CreateIndex
CREATE INDEX "Appointment_businessId_startTime_endTime_idx" ON "Appointment"("businessId", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "Business_businessType_idx" ON "Business"("businessType");

-- CreateIndex
CREATE INDEX "Conversation_businessId_customerId_status_idx" ON "Conversation"("businessId", "customerId", "status");

-- CreateIndex
CREATE INDEX "Conversation_customerId_startedAt_idx" ON "Conversation"("customerId", "startedAt");

-- CreateIndex
CREATE INDEX "ConversationSession_conversationId_status_idx" ON "ConversationSession"("conversationId", "status");

-- CreateIndex
CREATE INDEX "ConversationSession_businessId_flowKey_status_idx" ON "ConversationSession"("businessId", "flowKey", "status");

-- CreateIndex
CREATE INDEX "Customer_businessId_lastSeenAt_idx" ON "Customer"("businessId", "lastSeenAt");

-- Only one active conversation per customer and business
CREATE UNIQUE INDEX "Conversation_one_active_per_customer"
ON "Conversation" ("businessId", "customerId")
WHERE "status" IN ('OPEN', 'HUMAN_HANDOFF');

-- Only one active session per conversation
CREATE UNIQUE INDEX "ConversationSession_one_active_per_conversation"
ON "ConversationSession" ("conversationId")
WHERE "status" = 'ACTIVE';

-- Conversation lifecycle integrity
ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_closedAt_status_check"
CHECK (
  (
    "status" IN ('OPEN', 'HUMAN_HANDOFF')
    AND "closedAt" IS NULL
  )
  OR
  (
    "status" IN ('CLOSED', 'EXPIRED')
    AND "closedAt" IS NOT NULL
  )
);

-- CreateIndex
CREATE INDEX "ErrorLog_severity_idx" ON "ErrorLog"("severity");

-- CreateIndex
CREATE INDEX "ErrorLog_businessId_createdAt_idx" ON "ErrorLog"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorLog_correlationId_idx" ON "ErrorLog"("correlationId");

-- CreateIndex
CREATE INDEX "HumanHandoff_conversationId_idx" ON "HumanHandoff"("conversationId");

-- CreateIndex
CREATE INDEX "Integration_provider_integrationType_idx" ON "Integration"("provider", "integrationType");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_businessId_provider_integrationType_key" ON "Integration"("businessId", "provider", "integrationType");

-- CreateIndex
CREATE INDEX "InteractionLog_conversationId_idx" ON "InteractionLog"("conversationId");

-- CreateIndex
CREATE INDEX "InteractionLog_correlationId_idx" ON "InteractionLog"("correlationId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_businessId_direction_createdAt_idx" ON "Message"("businessId", "direction", "createdAt");

-- CreateIndex
CREATE INDEX "Message_businessId_deliveryStatus_idx" ON "Message"("businessId", "deliveryStatus");

-- AddForeignKey
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageStatusEvent" ADD CONSTRAINT "MessageStatusEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
