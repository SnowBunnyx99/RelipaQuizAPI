-- Multi-answer support: record every option a player selected (not just one).
-- SINGLE questions store a 1-element array; MULTIPLE store the full chosen set.
ALTER TABLE "Answer" ADD COLUMN "selectedOptionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill existing rows from the legacy single optionId column.
UPDATE "Answer"
SET "selectedOptionIds" = ARRAY["optionId"]
WHERE "optionId" IS NOT NULL;
