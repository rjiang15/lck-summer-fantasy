// Seed a mock league over already-ingested data (thin wrapper around the
// same code the in-app "Start mock season" button uses), plus a set of demo
// crystal ball questions so that screen has content too.
// Usage: npx tsx src/scripts/seed-demo.ts

import { prisma } from "../lib/db";
import { seedMockSeason } from "../lib/mock";
import { getDefaultTournamentId } from "../lib/fantasy";

async function main() {
  const tournamentId = await getDefaultTournamentId();
  if (!tournamentId) throw new Error("No ingested tournament found — run an ingest first.");
  const result = await seedMockSeason(tournamentId);
  console.log("Mock season seeded:", result);

  // Demo crystal ball questions (real question list comes from the commissioner)
  const league = await prisma.league.findFirst();
  const users = await prisma.user.findMany();
  if (!league) return;
  const proTeams = await prisma.proTeam.findMany({ take: 4 });
  const questions = [
    { prompt: "Who wins the split (playoff champion)?", answerType: "team", points: 10, partialRule: JSON.stringify({ condition: "reached-finals", fraction: 0.5 }) },
    { prompt: "Who finishes #1 in the regular season?", answerType: "team", points: 8, partialRule: JSON.stringify({ condition: "top-2", fraction: 0.5 }) },
    { prompt: "Highest KDA of the split (min. 1/3 of games)?", answerType: "player", points: 10, partialRule: JSON.stringify({ condition: "top-3", fraction: 0.5 }) },
    { prompt: "Will there be a reverse sweep in playoffs?", answerType: "yes_no", points: 3, partialRule: null },
    { prompt: "Name a player who gets a pentakill", answerType: "player", points: 12, partialRule: null },
  ];
  for (const q of questions) {
    await prisma.crystalBallQuestion.create({
      data: {
        leagueId: league.id,
        ...q,
        answers: {
          create: users.map((u, i) => ({
            userId: u.id,
            answer: q.answerType === "yes_no" ? (i % 2 ? "Yes" : "No") : proTeams[i % proTeams.length]?.id ?? "?",
          })),
        },
      },
    });
  }
  console.log(`Added ${questions.length} demo crystal ball questions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
