// View state: which split you're looking at and (optionally) a simulated
// point-in-time cursor for replaying a past split. Stored in cookies so it
// applies across every page.
//
// Cursor semantics: "Week X" = stats after ALL of week X's games are over.
// Week 0 = preseason (nothing played). The week after the cursor (X+1) is
// open for predictions. "Final" (default) = the whole split is visible.

import { cookies } from "next/headers";
import { prisma } from "./db";
import { getCurrentUser } from "./auth";
import { getPreferredMembership } from "./leagues";

export interface ViewState {
  leagueId: number;
  leagueSlug: string;
  leagueName: string;
  tournamentId: string;
  tournamentName: string;
  /** Completed-through week (0 = preseason). null = Final: everything visible. */
  completedWeek: number | null;
  /** The week currently open for predictions (completedWeek + 1). null when Final. */
  openWeek: number | null;
  maxWeek: number;
  /** Matches scheduled at/after this instant are treated as not-yet-played. */
  cutoff: Date | null;
  /** Live leagues follow the commissioner cursor and cannot preview results. */
  isLive: boolean;
}

export async function getViewState(leagueId?: number): Promise<ViewState | null> {
  const jar = await cookies();
  let resolvedLeagueId = leagueId;
  if (!resolvedLeagueId) {
    const user = await getCurrentUser();
    if (!user) return null;
    resolvedLeagueId = (await getPreferredMembership(user.id))?.leagueId;
  }
  if (!resolvedLeagueId) return null;
  const league = await prisma.league.findUnique({ where: { id: resolvedLeagueId } });
  if (!league) return null;
  const tournament = await prisma.tournament.findUnique({ where: { id: league.tournamentId } });
  if (!tournament) return null;
  const tournamentId = league.tournamentId;

  const weeks = await prisma.week.findMany({
    where: { tournamentId },
    orderBy: { number: "asc" },
  });
  const maxWeek = weeks.length ? weeks[weeks.length - 1].number : 0;
  const isLive = !league.isSimulation && league.seasonStatus !== "FINAL";
  const raw = jar.get(`viewWeek_${league.id}`)?.value;
  let completedWeek: number | null;
  if (isLive) {
    completedWeek = league.currentWeek;
  } else {
    completedWeek = raw != null && raw !== "final" ? parseInt(raw, 10) : null;
    // "after the last week" is the same as Final for archived/simulated splits.
    if (
      completedWeek !== null &&
      (isNaN(completedWeek) || completedWeek < 0 || completedWeek >= maxWeek)
    ) {
      completedWeek = null;
    }
  }
  const openWeek = completedWeek === null ? null : completedWeek + 1;
  const cutoff =
    openWeek === null ? null : weeks.find((w) => w.number === openWeek)?.startsAt ?? null;

  return {
    leagueId: league.id,
    leagueSlug: league.slug,
    leagueName: league.name,
    tournamentId,
    tournamentName: tournament.name,
    completedWeek,
    openWeek,
    maxWeek,
    cutoff,
    isLive,
  };
}

/** Is this match's result visible under the current view? */
export function isFinished(
  m: { winner: string | null; scheduledAt: Date },
  cutoff: Date | null,
): boolean {
  return m.winner !== null && (cutoff === null || m.scheduledAt < cutoff);
}

export async function listTournaments() {
  return prisma.tournament.findMany({
    where: { hidden: false },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });
}
