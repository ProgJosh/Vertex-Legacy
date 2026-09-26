-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "autoRenew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dailyRateBasisPoints" INTEGER,
ADD COLUMN     "fixedReturnCentavos" BIGINT,
ADD COLUMN     "maxDurationDays" INTEGER,
ADD COLUMN     "productType" TEXT NOT NULL DEFAULT 'subscription';
