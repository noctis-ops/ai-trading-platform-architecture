ALTER TABLE "customers" ADD COLUMN "referral_code" text;
ALTER TABLE "customers" ADD CONSTRAINT "customers_referral_code_unique" UNIQUE("referral_code");
ALTER TABLE "customers" ADD COLUMN "referred_by" uuid;
