import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/fantasy";
import { savePick } from "./actions";

export const dynamic = "force-dynamic";

function scorelines(bestOf: number, team1: string, team2: string) {
  const need = Math.floor(bestOf / 2) + 1;
  const options: { value: string; label: string }[] = [];
  for (let loser = need - 1; loser >= 0; loser--) {
    options.push({ value: `${team1}|${need}-${loser}`, label: `${team1} wins ${need}-${loser}` });
  }
  for (let loser = 0; loser < need; loser++) {
    options.push({ value: `${team2}|${loser}-${need}`, label: `${team2} wins ${need}-${loser}` });
  }
  return options;
}

export default async function PicksPage() {
  const user = await requireUser();
  const fantasyTeam = await prisma.fantasyTeam.findFirst({
    where: { userId: user.id },
    include: { league: true },
  });
  if (!fantasyTeam) return <p>You are not a member of a fantasy league.</p>;

  const leagueWeek = await prisma.leagueWeek.findFirst({
    where: {
      leagueId: fantasyTeam.leagueId,
      week: { number: fantasyTeam.league.currentWeek + 1 },
    },
    include: {
      week: { include: { matches: { orderBy: { scheduledAt: "asc" } } } },
    },
  });

  if (!leagueWeek || leagueWeek.status !== "OPEN") {
    return (
      <>
        <h1>Picks</h1>
        <p>No slate is open yet. During Week {fantasyTeam.league.currentWeek}, the commissioner must pull and open Week {fantasyTeam.league.currentWeek + 1} before predictions can be submitted.</p>
      </>
    );
  }
  const picks = await prisma.pickem.findMany({
    where: { userId: user.id, match: { weekId: leagueWeek.weekId } },
  });

  return (
    <>
      <h1>Picks for Week {leagueWeek.week.number}</h1>
      <p className="muted small">
        It is currently <b>Week {fantasyTeam.league.currentWeek}</b>{fantasyTeam.league.currentWeek === 0 ? " (preseason)" : ""}. Signed in as <b>{user.username}</b>.
        Picks lock when the commissioner locks the upcoming week
        {fantasyTeam.league.isSimulation ? "." : " or when each series begins, whichever comes first."}
      </p>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Date</th><th>Series</th><th>Your prediction</th></tr></thead>
          <tbody>
            {leagueWeek.week.matches.map((match) => {
              const pick = picks.find((row) => row.matchId === match.id);
              const current = pick ? `${pick.predictedWinner}|${pick.predictedScore ?? ""}` : "";
              const started = !fantasyTeam.league.isSimulation && match.scheduledAt <= new Date();
              return (
                <tr key={match.id}>
                  <td>{fmtDate(match.scheduledAt)}</td>
                  <td>{match.team1} vs {match.team2} <span className="muted small">(Bo{match.bestOf})</span></td>
                  <td>
                    {started ? <span className="badge pending">locked</span> : (
                      <form action={savePick} className="inline-form">
                        <input type="hidden" name="matchId" value={match.id} />
                        <select name="choice" defaultValue={current} required>
                          <option value="" disabled>— pick a result —</option>
                          {scorelines(match.bestOf, match.team1, match.team2).map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <button type="submit">Save</button>
                        {pick && <span className="badge win">saved</span>}
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
