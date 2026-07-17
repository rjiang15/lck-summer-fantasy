// Explicit, audited recalculation of already-published weekly score snapshots.
// Requires both league and week arguments to avoid accidental season-wide rewrites.

import { prisma } from "../lib/db";
import { parseScoring } from "../lib/fantasy";
import { calculateWeeklyScores } from "../lib/season";

const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  const leagueKey = option("league");
  const weekNumbers = (option("weeks") ?? "")
    .split(",")
    .filter(Boolean)
    .map(Number);
  if (!leagueKey || weekNumbers.length === 0 || weekNumbers.some((week) => !Number.isInteger(week) || week < 1)) {
    throw new Error("Usage: npm run season:rescore -- --league=<id-or-slug> --weeks=1,2");
  }

  const numericId = Number(leagueKey);
  const league = await prisma.league.findFirst({
    where: Number.isInteger(numericId) && String(numericId) === leagueKey
      ? { id: numericId }
      : { slug: leagueKey },
  });
  if (!league) throw new Error(`League not found: ${leagueKey}`);

  const weeks = await prisma.leagueWeek.findMany({
    where: {
      leagueId: league.id,
      status: "PUBLISHED",
      week: { number: { in: weekNumbers } },
    },
    include: { week: true, weeklyScores: true },
    orderBy: { week: { number: "asc" } },
  });
  if (weeks.length !== new Set(weekNumbers).size) {
    const found = new Set(weeks.map((row) => row.week.number));
    const missing = weekNumbers.filter((week) => !found.has(week));
    throw new Error(`These weeks are not published in ${league.name}: ${missing.join(", ")}`);
  }

  const scoring = parseScoring(league.scoringConfig);
  await prisma.league.update({
    where: { id: league.id },
    data: { scoringConfig: JSON.stringify(scoring) },
  });

  for (const week of weeks) {
    const beforeRoster = week.weeklyScores.reduce((sum, score) => sum + score.rosterPts, 0);
    const beforePickems = week.weeklyScores.reduce((sum, score) => sum + score.pickemPts, 0);
    await calculateWeeklyScores(week.id, {
      allowPublished: true,
      auditReason: `Commissioner-approved retroactive calibration to scoring v${scoring.version}`,
    });
    const afterRows = await prisma.weeklyScore.findMany({ where: { leagueWeekId: week.id } });
    const afterRoster = afterRows.reduce((sum, score) => sum + score.rosterPts, 0);
    const afterPickems = afterRows.reduce((sum, score) => sum + score.pickemPts, 0);
    console.log(`Week ${week.week.number}: roster ${beforeRoster.toFixed(1)} -> ${afterRoster.toFixed(1)}, Pick'ems ${beforePickems.toFixed(1)} -> ${afterPickems.toFixed(1)} (${afterRows.length} teams)`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
