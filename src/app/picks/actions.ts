"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireLeagueMember } from "@/lib/auth";
import { validSeriesPrediction } from "@/lib/season";

export async function savePick(formData: FormData) {
  const leagueId = Number(formData.get("leagueId"));
  const { user, league } = await requireLeagueMember(leagueId);
  const matchId = String(formData.get("matchId"));
  const choice = String(formData.get("choice")); // "winner|t1Score-t2Score"
  if (!matchId || !choice.includes("|")) throw new Error("Invalid prediction");
  const [predictedWinner, predictedScore] = choice.split("|");
  const match = await prisma.match.findUniqueOrThrow({
    where: { id: matchId },
    include: { week: true },
  });
  const fantasyTeam = await prisma.fantasyTeam.findUnique({ where: { leagueId_userId: { leagueId, userId: user.id } } });
  if (!fantasyTeam || !match.weekId || match.tournamentId !== league.tournamentId) throw new Error("This match is not part of your league");
  const leagueWeek = await prisma.leagueWeek.findUnique({
    where: { leagueId_weekId: { leagueId, weekId: match.weekId } },
  });
  if (!leagueWeek || leagueWeek.status !== "OPEN" || league.currentWeek + 1 !== match.week?.number) {
    throw new Error("Picks are locked for this week");
  }
  if (!league.isSimulation && match.scheduledAt <= new Date()) {
    throw new Error("This series has already started");
  }
  if (!validSeriesPrediction(match.bestOf, match.team1, match.team2, predictedWinner, predictedScore)) {
    throw new Error("Invalid series result");
  }
  await prisma.pickem.upsert({
    where: { leagueId_userId_matchId: { leagueId, userId: user.id, matchId } },
    create: { leagueId, userId: user.id, matchId, predictedWinner, predictedScore },
    update: { predictedWinner, predictedScore },
  });
  revalidatePath("/picks");
}
