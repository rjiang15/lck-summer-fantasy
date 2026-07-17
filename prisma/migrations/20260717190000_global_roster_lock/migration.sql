ALTER TABLE "League" ADD COLUMN "rostersLockedAt" DATETIME;

-- Preserve the intent of leagues that had already used the old per-week
-- roster lock before this became a league-wide control.
UPDATE "League"
SET "rostersLockedAt" = (
  SELECT MAX("rosterLockedAt")
  FROM "LeagueWeek"
  WHERE "LeagueWeek"."leagueId" = "League"."id"
)
WHERE EXISTS (
  SELECT 1 FROM "LeagueWeek"
  WHERE "LeagueWeek"."leagueId" = "League"."id"
    AND "LeagueWeek"."rosterLockedAt" IS NOT NULL
);
