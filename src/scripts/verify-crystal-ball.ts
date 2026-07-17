// Read-only audit: prove every configured automatic metric resolves against
// the currently stored tournament data without settling the league.

import { prisma } from "../lib/db";
import { assertCrystalBallDataComplete, loadCrystalBallSnapshot, resolveCrystalBallMetric } from "../lib/crystal-ball";

async function main() {
  const league = await prisma.league.findFirstOrThrow({ include: { cbQuestions: { orderBy: { id: "asc" } } } });
  const snapshot = await loadCrystalBallSnapshot(league.tournamentId);
  assertCrystalBallDataComplete(snapshot, false);
  const rows = league.cbQuestions.map((question) => {
    if (!question.metricKey) throw new Error(`Question ${question.id} is missing its automatic metric key`);
    const config = question.resolverConfig ? JSON.parse(question.resolverConfig) as Record<string, string | number> : {};
    const result = resolveCrystalBallMetric(question.metricKey, snapshot, config);
    return { metric: question.metricKey, result: result.target ?? result.acceptedAnswers.join(" / "), evidence: result.evidence };
  });
  console.table(rows);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
