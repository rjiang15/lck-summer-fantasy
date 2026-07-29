// Home: database viewer — every match/game of the selected split,
// respecting the week cursor (future results hidden).
import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate, fmtLength, parseScoring } from "@/lib/fantasy";
import { getDataViewState, isFinished, isGameFinished } from "@/lib/view";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TeamLabel } from "@/components/GameIdentity";
import { areWeeklyPicksPublic } from "@/lib/pick-privacy";
import { pickemPoints } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const view = await getDataViewState();
  if (!view) {
    if (await getCurrentUser()) redirect("/leagues");
    return <section className="card empty-state"><h1>LCK Fantasy</h1><p>Run one account across multiple live or test leagues, with weekly pick&apos;ems, rosters, Crystal Ball predictions, and granular LCK stats.</p><div className="inline-form"><Link href="/signup">Create account</Link><Link href="/login">Sign in</Link><Link href="/join">Join with invite</Link></div></section>;
  }
  const [weeks, league, leagueWeeks, pickems] = await Promise.all([
    prisma.week.findMany({
      where: { tournamentId: view.tournamentId },
      orderBy: { number: "asc" },
      include: {
        matches: {
          orderBy: { scheduledAt: "asc" },
          include: { games: { orderBy: { gameNumber: "asc" } } },
        },
      },
    }),
    prisma.league.findUnique({ where: { id: view.leagueId }, select: { scoringConfig: true } }),
    prisma.leagueWeek.findMany({
      where: { leagueId: view.leagueId },
      select: { weekId: true, status: true, picksLockedAt: true },
    }),
    prisma.pickem.findMany({
      where: { leagueId: view.leagueId },
      include: { user: true },
      orderBy: { user: { username: "asc" } },
    }),
  ]);
  const scoring = parseScoring(league?.scoringConfig);
  const publicPickWeekIds = new Set(
    leagueWeeks.filter(areWeeklyPicksPublic).map((week) => week.weekId),
  );
  // A replay league knows the complete historical slate from Week 0, just as
  // a live current-season league knows its announced future schedule. Only the
  // result cells remain gated by the completed-week cutoff.
  const visibleWeeks =
    view.isCurrentSeason || view.isSimulation || view.openWeek === null
      ? weeks
      : weeks.filter((w) => w.number <= view.openWeek!);

  return (
    <>
      <h1>{view.tournamentName}</h1>
      <p className="muted small">
        Every series and game in the split. Click a game to see the full scoreboard.
        {view.isResearch && <> This is read-only historical research for your current fantasy season.</>}
        {view.completedWeek !== null && (
          <>
            {" "}
            {view.showsLiveProgress
              ? <>Week {view.openWeek} is live; completed games and locked predictions appear as they are refreshed.</>
              : <>Viewing after <b>week {view.completedWeek}</b> — week {view.openWeek} is open for <Link href="/picks">picks</Link>.</>}
          </>
        )}
      </p>
      {visibleWeeks.map((week) => (
        <section key={week.id}>
          <h2>
            Week {week.number}{week.sourceLabel && week.sourceLabel !== `Week ${week.number}` ? ` · LCK ${week.sourceLabel}` : ""}{" "}
            <span className="muted small">
              {fmtDate(week.startsAt)} – {fmtDate(week.endsAt)}
            </span>
          </h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Series</th>
                  <th>Result</th>
                  <th>Games</th>
                  <th>Participant predictions</th>
                </tr>
              </thead>
              <tbody>
                {week.matches.map((m) => {
                  const done = isFinished(m, view.cutoff);
                  const visibleGames = m.games.filter((game) => isGameFinished(game, m, view.cutoff));
                  const inProgress = !done && visibleGames.length > 0;
                  const team1Games = visibleGames.filter((game) => game.winner === m.team1).length;
                  const team2Games = visibleGames.filter((game) => game.winner === m.team2).length;
                  const visiblePicks = publicPickWeekIds.has(week.id)
                    ? pickems.filter((pick) => pick.matchId === m.id)
                    : [];
                  return (
                    <tr key={m.id}>
                      <td>{fmtDate(m.scheduledAt)}</td>
                      <td><span className="entity-matchup">
                        <TeamLabel name={m.team1} size="xs" className={done && m.winner !== m.team1 ? "subtle muted" : ""} />
                        <em>vs</em>
                        <TeamLabel name={m.team2} size="xs" className={done && m.winner !== m.team2 ? "subtle muted" : ""} />
                      </span></td>
                      <td>
                        {done ? (
                          <>
                            <span className="series-result"><TeamLabel name={m.winner!} size="xs" /><b>{m.team1Score}–{m.team2Score}</b></span>
                          </>
                        ) : inProgress ? (
                          <span className="series-result"><span className="badge win">live</span><b>{team1Games}–{team2Games}</b></span>
                        ) : (
                          <span className="badge pending">upcoming</span>
                        )}
                      </td>
                      <td>
                        {visibleGames.length > 0
                          ? visibleGames.map((g) => (
                            <Link
                              key={g.id}
                              className="gamechip"
                              href={`/games/${encodeURIComponent(g.id)}`}
                            >
                              G{g.gameNumber} · {fmtLength(g.lengthSec)}
                            </Link>
                          ))
                          : "—"}
                      </td>
                      <td className="prediction-cell">
                        {visiblePicks.length > 0 ? visiblePicks.map((pick) => {
                          const points = done && m.winner && m.team1Score != null && m.team2Score != null
                            ? pickemPoints(
                                pick.predictedWinner,
                                pick.predictedScore,
                                m.winner,
                                `${m.team1Score}-${m.team2Score}`,
                                scoring,
                              )
                            : null;
                          return <span className="game-prediction" key={pick.id}>
                            <b>{pick.user.username}</b>
                            <span><TeamLabel name={pick.predictedWinner} size="xs" /> {pick.predictedScore ?? "—"}</span>
                            {points !== null && <small className={points > 0 ? "win-text" : "muted"}>{points > 0 ? `+${points}` : "0"} pts</small>}
                          </span>;
                        }) : <span className="muted">{publicPickWeekIds.has(week.id) ? "No predictions" : "Hidden until lock"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
