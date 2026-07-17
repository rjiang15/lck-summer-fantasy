// Replace legacy/manual Crystal Ball questions only when a league has no
// participant answers. Existing predictions are never deleted implicitly.

import { prisma } from "../lib/db";
import { DEFAULT_CRYSTAL_BALL } from "../lib/crystal-ball";

async function main() {
  const leagues = await prisma.league.findMany({
    include: { cbQuestions: { include: { _count: { select: { answers: true } } } } },
  });
  const results: Array<{ leagueId: number; status: string; questions: number }> = [];
  for (const league of leagues) {
    const answers = league.cbQuestions.reduce((sum, question) => sum + question._count.answers, 0);
    const currentKeys = new Set(league.cbQuestions.flatMap((question) => question.metricKey ? [question.metricKey] : []));
    const alreadyCurrent = DEFAULT_CRYSTAL_BALL.every((question) => currentKeys.has(question.metricKey));
    if (alreadyCurrent) {
      results.push({ leagueId: league.id, status: "already current", questions: league.cbQuestions.length });
      continue;
    }
    if (answers > 0) {
      results.push({ leagueId: league.id, status: `skipped (${answers} saved answers)`, questions: league.cbQuestions.length });
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.crystalBallQuestion.deleteMany({ where: { leagueId: league.id } });
      await tx.crystalBallQuestion.createMany({ data: DEFAULT_CRYSTAL_BALL.map((question) => ({ leagueId: league.id, ...question })) });
    });
    results.push({ leagueId: league.id, status: "synchronized", questions: DEFAULT_CRYSTAL_BALL.length });
  }
  console.table(results);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
