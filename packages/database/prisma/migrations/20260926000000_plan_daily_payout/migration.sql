-- Adds the fixed-schedule payout figures published in the company VIP plan sheet
-- (plan name / price / daily profit / cycle days / total return). Defaults of 0
-- keep every existing mandate valid, so the columns are additive and no existing
-- plan silently acquires a promised return.
ALTER TABLE "Plan" ADD COLUMN "dailyPayoutCentavos" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Plan" ADD COLUMN "totalReturnCentavos" BIGINT NOT NULL DEFAULT 0;
