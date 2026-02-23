-- AlterTable
ALTER TABLE "User"
ADD COLUMN "emailVerificationCodeHash" TEXT,
ADD COLUMN "emailVerificationExpiresAt" TIMESTAMP(3),
ADD COLUMN "isEmailVerified" BOOLEAN NOT NULL DEFAULT false;

