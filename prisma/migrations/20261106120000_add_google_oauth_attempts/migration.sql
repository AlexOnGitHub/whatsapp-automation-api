CREATE TABLE "GoogleOAuthAttempt" (
    "nonce" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleOAuthAttempt_pkey" PRIMARY KEY ("nonce")
);

CREATE INDEX "GoogleOAuthAttempt_expiresAt_idx" ON "GoogleOAuthAttempt"("expiresAt");
CREATE INDEX "GoogleOAuthAttempt_businessId_idx" ON "GoogleOAuthAttempt"("businessId");

ALTER TABLE "GoogleOAuthAttempt" ADD CONSTRAINT "GoogleOAuthAttempt_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
