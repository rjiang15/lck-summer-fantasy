// Replace legacy/manual Crystal Ball questions only when a league has no
// participant answers. Current automatic questions can safely receive updated
// prompts/scoring rules without deleting participant predictions.

import { prisma } from "../lib/db";
import { DEFAULT_CRYSTAL_BALL, settleCrystalBall } from "../lib/crystal-ball";

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
      // Capture the new ranking payload before changing a previously settled
      // league to RANKED grading, so historical winners never temporarily lose points.
      if (league.seasonStatus === "FINAL") await settleCrystalBall(league.id);
      const byMetric = new Map(league.cbQuestions.flatMap((question) => question.metricKey ? [[question.metricKey, question] as const] : []));
      await prisma.$transaction(DEFAULT_CRYSTAL_BALL.map((definition) => prisma.crystalBallQuestion.update({
        where: { id: byMetric.get(definition.metricKey)!.id },
        data: {
          prompt: definition.prompt,
          answerType: definition.answerType,
          points: definition.points,
          gradingMode: definition.gradingMode,
          resolverConfig: definition.resolverConfig,
          partialRule: null,
          partialAnswers: null,
        },
      })));
      results.push({ leagueId: league.id, status: `scoring synchronized (${answers} answers preserved${league.seasonStatus === "FINAL" ? ", final results regraded" : ""})`, questions: league.cbQuestions.length });
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
