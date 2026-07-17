// Seed a mock league over already-ingested data (thin wrapper around the
// same code the in-app "Start mock season" button uses). The mock league
// receives the same twenty automatically graded Crystal Ball questions as a
// normal league.
// Usage: npx tsx src/scripts/seed-demo.ts

import { prisma } from "../lib/db";
import { seedMockSeason } from "../lib/mock";
import { getDefaultTournamentId } from "../lib/fantasy";

async function main() {
  const tournamentId = await getDefaultTournamentId();
  if (!tournamentId) throw new Error("No ingested tournament found — run an ingest first.");
  const result = await seedMockSeason(tournamentId);
  console.log("Mock season seeded:", result);

  const league = await prisma.league.findFirst();
  if (!league) return;
  console.log(`Added ${await prisma.crystalBallQuestion.count({ where: { leagueId: league.id } })} automatic Crystal Ball questions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
