ALTER TABLE "Deposit"
ADD COLUMN "paymentChannel" TEXT,
ADD COLUMN "senderName" TEXT,
ADD COLUMN "senderMobileLast4" TEXT,
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "reviewedBy" UUID,
ADD COLUMN "reviewReason" TEXT;
