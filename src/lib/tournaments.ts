import { prisma } from "./db";

export const CURRENT_TOURNAMENT = "CURRENT";
export const PAST_TOURNAMENT = "PAST";

export interface TournamentChronology {
  id: string;
  seasonOrder: number;
  dateStart: Date | null;
}

/** A league can see its own season and any season that existed before it. */
export function isResearchSeasonVisible(
  candidate: TournamentChronology,
  leagueTournament: TournamentChronology,
) {
  if (candidate.id === leagueTournament.id) return true;
  if (candidate.seasonOrder > 0 && leagueTournament.seasonOrder > 0) {
    return candidate.seasonOrder < leagueTournament.seasonOrder;
  }
  if (candidate.dateStart && leagueTournament.dateStart) {
    return candidate.dateStart <= leagueTournament.dateStart;
  }
  return false;
}

/**
 * Rebuild deterministic chronology and make one imported tournament current.
 * Existing fantasy leagues keep their tournamentId and are never rewritten.
 */
export async function setCurrentTournament(tournamentId: string) {
  const tournaments = await prisma.tournament.findMany({
    where: { hidden: false },
    orderBy: [{ dateStart: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!tournaments.some((tournament) => tournament.id === tournamentId)) {
    throw new Error(`Tournament is not imported or is hidden: ${tournamentId}`);
  }

  await prisma.$transaction(
    tournaments.map((tournament, index) => prisma.tournament.update({
      where: { id: tournament.id },
      data: {
        seasonOrder: index + 1,
        catalogStatus: tournament.id === tournamentId ? CURRENT_TOURNAMENT : PAST_TOURNAMENT,
      },
    })),
  );
}
