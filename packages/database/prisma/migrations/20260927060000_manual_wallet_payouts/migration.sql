ALTER TABLE "Withdrawal"
ADD COLUMN "payoutSubmittedBy" UUID,
ADD COLUMN "payoutSubmittedAt" TIMESTAMP(3),
ADD COLUMN "payoutConfirmedBy" UUID,
ADD COLUMN "payoutConfirmedAt" TIMESTAMP(3),
ADD COLUMN "payoutNote" TEXT;
