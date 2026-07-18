// Home: database viewer — every match/game of the selected split,
// respecting the week cursor (future results hidden).
import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate, fmtLength } from "@/lib/fantasy";
import { getDataViewState, isFinished } from "@/lib/view";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TeamLabel } from "@/components/GameIdentity";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const view = await getDataViewState();
  if (!view) {
    if (await getCurrentUser()) redirect("/leagues");
    return <section className="card empty-state"><h1>LCK Fantasy</h1><p>Run one account across multiple live or test leagues, with weekly pick&apos;ems, rosters, Crystal Ball predictions, and granular LCK stats.</p><div className="inline-form"><Link href="/signup">Create account</Link><Link href="/login">Sign in</Link><Link href="/join">Join with invite</Link></div></section>;
  }
  const weeks = await prisma.week.findMany({
    where: { tournamentId: view.tournamentId },
    orderBy: { number: "asc" },
    include: {
      matches: {
        orderBy: { scheduledAt: "asc" },
        include: { games: { orderBy: { gameNumber: "asc" } } },
      },
    },
  });
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
            Viewing after <b>week {view.completedWeek}</b> — week {view.openWeek} is open
            for <Link href="/picks">picks</Link>.
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
                </tr>
              </thead>
              <tbody>
                {week.matches.map((m) => {
                  const done = isFinished(m, view.cutoff);
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
                        ) : (
                          <span className="badge pending">upcoming</span>
                        )}
                      </td>
                      <td>
                        {done &&
                          m.games.map((g) => (
                            <Link
                              key={g.id}
                              className="gamechip"
                              href={`/games/${encodeURIComponent(g.id)}`}
                            >
                              G{g.gameNumber} · {fmtLength(g.lengthSec)}
                            </Link>
                          ))}
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
