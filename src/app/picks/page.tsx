import { requireLeagueMember } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate, parseScoring } from "@/lib/fantasy";
import PicksForm from "./PicksForm";

export const dynamic = "force-dynamic";

export default async function PicksPage() {
  const { user, league } = await requireLeagueMember();
  const fantasyTeam = await prisma.fantasyTeam.findUnique({ where: { leagueId_userId: { leagueId: league.id, userId: user.id } } });
  if (!fantasyTeam) return <><h1>Picks</h1><p>You need a fantasy team in this league before submitting pick&apos;ems.</p></>;
  const leagueWeek = await prisma.leagueWeek.findFirst({
    where: { leagueId: league.id, week: { number: league.currentWeek + 1 } },
    include: { week: { include: { matches: { orderBy: { scheduledAt: "asc" } } } } },
  });
  if (!leagueWeek || leagueWeek.status === "UPCOMING") return <><h1>Picks</h1><p>No slate is open yet. During Week {league.currentWeek}, the commissioner must pull and open Week {league.currentWeek + 1} before predictions can be submitted.</p></>;
  const picks = await prisma.pickem.findMany({ where: { leagueId: league.id, userId: user.id, match: { weekId: leagueWeek.weekId } } });
  const now = new Date();
  const picksLocked = Boolean(leagueWeek.picksLockedAt) || leagueWeek.status !== "OPEN";
  const scoring = parseScoring(league.scoringConfig);

  return <>
    <h1>Picks for Week {leagueWeek.week.number}</h1>
    <p className="muted small">{picksLocked ? "The commissioner has locked this week's picks. Your saved predictions are shown below." : `Choose each series winner, then set how many games the losing team takes. Picks lock when the commissioner locks the picks${league.isSimulation ? "." : " or when each series begins, whichever comes first."}`}</p>
    <p className="card small"><b>Scoring:</b> +{scoring.pickem.correctWinner} for the correct series winner, plus +{scoring.pickem.exactScoreBonus} for the exact series score.</p>
    <PicksForm leagueId={league.id} leagueWeekId={leagueWeek.id} weekLocked={picksLocked} matches={leagueWeek.week.matches.map((match) => {
      const existing = picks.find((pick) => pick.matchId === match.id);
      const [left, right] = (existing?.predictedScore ?? "0-0").split("-").map(Number);
      const loserGames = existing?.predictedWinner === match.team1 ? right : existing?.predictedWinner === match.team2 ? left : 0;
      return {
        id: match.id, team1: match.team1, team2: match.team2, bestOf: match.bestOf,
        dateLabel: fmtDate(match.scheduledAt), started: picksLocked || (!league.isSimulation && match.scheduledAt <= now),
        existingWinner: existing?.predictedWinner ?? null, existingLoserGames: Number.isInteger(loserGames) ? loserGames : 0,
      };
    })} />
  </>;
}
