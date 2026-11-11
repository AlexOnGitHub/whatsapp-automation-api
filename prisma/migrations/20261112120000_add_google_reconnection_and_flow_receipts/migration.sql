ALTER TABLE "Integration" ADD COLUMN "pendingCredentialsEncrypted" TEXT;

ALTER TABLE "Message" ADD COLUMN "flowProcessingStartedAt" TIMESTAMP(3),
ADD COLUMN "flowResult" JSONB;
