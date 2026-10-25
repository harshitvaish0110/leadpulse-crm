-- deals.winProbability is a 0–1 probability. Earlier scoring runs stored
-- percentages (0–100) for open deals; convert those, then enforce the range.
UPDATE "deals" SET "winProbability" = LEAST("winProbability" / 100.0, 1) WHERE "winProbability" > 1;
UPDATE "deals" SET "winProbability" = 0 WHERE "winProbability" < 0;

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_winProbability_range" CHECK ("winProbability" >= 0 AND "winProbability" <= 1);
