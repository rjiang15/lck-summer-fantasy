import { prisma } from "../lib/db";
import { setCurrentTournament } from "../lib/tournaments";

async function main() {
  const tournamentId = process.argv[2];
  if (!tournamentId) {
    throw new Error('Usage: npm run tournament:current -- "<Leaguepedia OverviewPage>"');
  }
  await setCurrentTournament(tournamentId);
  console.log(`Current tournament: ${tournamentId}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
