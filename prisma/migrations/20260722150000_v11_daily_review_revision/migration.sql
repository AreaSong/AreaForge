-- Additive corrective migration for canonical DailyReview CAS updates.
ALTER TABLE "DailyReview" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
