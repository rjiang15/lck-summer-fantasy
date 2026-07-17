// View state: which split you're looking at and (optionally) a simulated
// point-in-time cursor for replaying a past split. Stored in cookies so it
// applies across every page.
//
// Cursor semantics: "Week X" = stats after ALL of week X's games are over.
// Week 0 = preseason (nothing played). The week after the cursor (X+1) is
// open for predictions. "Final" (default) = the whole split is visible.

import { cookies } from "next/headers";
import { prisma } from "./db";
import { getDefaultTournamentId } from "./fantasy";

export interface ViewState {
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

export async function getViewState(): Promise<ViewState | null> {
  const jar = await cookies();
  const tournaments = await prisma.tournament.findMany({
    where: { hidden: false },
    select: { id: true, name: true },
  });
  let tournamentId = jar.get("viewTournament")?.value ?? null;
  if (!tournamentId || !tournaments.some((t) => t.id === tournamentId)) {
    tournamentId = await getDefaultTournamentId();
  }
  if (!tournamentId) return null;

  const weeks = await prisma.week.findMany({
    where: { tournamentId },
    orderBy: { number: "asc" },
  });
  const maxWeek = weeks.length ? weeks[weeks.length - 1].number : 0;
  const liveLeague = await prisma.league.findFirst({
    where: { tournamentId, isSimulation: false, seasonStatus: { not: "FINAL" } },
    select: { currentWeek: true },
  });

  const raw = jar.get("viewWeek")?.value;
  let completedWeek: number | null;
  if (liveLeague) {
    completedWeek = liveLeague.currentWeek;
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
    tournamentId,
    tournamentName: tournaments.find((t) => t.id === tournamentId)?.name ?? tournamentId,
    completedWeek,
    openWeek,
    maxWeek,
    cutoff,
    isLive: liveLeague !== null,
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
