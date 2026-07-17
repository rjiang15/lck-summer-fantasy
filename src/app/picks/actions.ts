"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireLeagueMember } from "@/lib/auth";
import { validSeriesPrediction } from "@/lib/season";

export type PickSaveState = { ok: boolean; message: string } | null;

export async function savePicks(_previous: PickSaveState, formData: FormData): Promise<PickSaveState> {
  const leagueId = Number(formData.get("leagueId"));
  const leagueWeekId = Number(formData.get("leagueWeekId"));
  try {
    const { user, league } = await requireLeagueMember(leagueId);
    const fantasyTeam = await prisma.fantasyTeam.findUnique({ where: { leagueId_userId: { leagueId, userId: user.id } } });
    if (!fantasyTeam) throw new Error("You need a fantasy team to submit pick'ems");
    const leagueWeek = await prisma.leagueWeek.findUnique({
      where: { id: leagueWeekId },
      include: { week: { include: { matches: { orderBy: { scheduledAt: "asc" } } } } },
    });
    if (!leagueWeek || leagueWeek.leagueId !== leagueId || leagueWeek.status !== "OPEN" || leagueWeek.picksLockedAt || leagueWeek.week.number !== league.currentWeek + 1) {
      throw new Error("Picks are locked for this week");
    }
    const now = new Date();
    const updates: { matchId: string; predictedWinner: string; predictedScore: string }[] = [];
    let locked = 0;
    for (const match of leagueWeek.week.matches) {
      if (!league.isSimulation && match.scheduledAt <= now) {
        locked++;
        continue;
      }
      const winner = String(formData.get(`winner_${match.id}`) ?? "");
      const loserGames = Number(formData.get(`loserGames_${match.id}`));
      const needed = Math.floor(match.bestOf / 2) + 1;
      if (![match.team1, match.team2].includes(winner) || !Number.isInteger(loserGames) || loserGames < 0 || loserGames >= needed) {
        throw new Error(`Choose a winner and valid score for ${match.team1} vs ${match.team2}`);
      }
      const predictedScore = winner === match.team1 ? `${needed}-${loserGames}` : `${loserGames}-${needed}`;
      if (!validSeriesPrediction(match.bestOf, match.team1, match.team2, winner, predictedScore)) {
        throw new Error(`Invalid series result for ${match.team1} vs ${match.team2}`);
      }
      updates.push({ matchId: match.id, predictedWinner: winner, predictedScore });
    }
    if (updates.length === 0) throw new Error("There are no unlocked series to save");
    await prisma.$transaction(async (tx) => {
      // Recheck inside the write transaction so a submission that started just
      // before the commissioner clicked Lock cannot commit after the lock.
      const currentWeek = await tx.leagueWeek.findUnique({
        where: { id: leagueWeekId },
        select: { leagueId: true, status: true, picksLockedAt: true },
      });
      if (!currentWeek || currentWeek.leagueId !== leagueId || currentWeek.status !== "OPEN" || currentWeek.picksLockedAt) {
        throw new Error("Picks were locked while this submission was being saved");
      }
      for (const pick of updates) {
        await tx.pickem.upsert({
          where: { leagueId_userId_matchId: { leagueId, userId: user.id, matchId: pick.matchId } },
          create: { leagueId, userId: user.id, ...pick },
          update: { predictedWinner: pick.predictedWinner, predictedScore: pick.predictedScore },
        });
      }
    });
    revalidatePath("/picks");
    return { ok: true, message: `Saved ${updates.length} pick${updates.length === 1 ? "" : "s"}${locked ? `; ${locked} started series stayed locked` : ""}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
