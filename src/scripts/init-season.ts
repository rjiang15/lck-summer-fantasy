import { prisma } from "../lib/db";
import { ensureLeagueWeeks } from "../lib/season";

async function main() {
  const league = await prisma.league.findFirst();
  if (!league) throw new Error("No fantasy league exists");
  const weeks = await ensureLeagueWeeks(league.id);
  const first = weeks[0];
  await prisma.league.update({
    where: { id: league.id },
    data: {
      isSimulation: league.name.toLowerCase().includes("mock"),
      currentWeek: 0,
    },
  });
  if (first && weeks.every((week) => week.status === "UPCOMING")) {
    await prisma.leagueWeek.update({
      where: { id: first.id },
      data: { status: "OPEN", picksOpenAt: new Date() },
    });
  }
  console.log({ league: league.name, currentWeek: 0, picksForWeek: first?.week.number ?? null });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
