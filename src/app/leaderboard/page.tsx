// Leaderboard: pro players by fantasy points + fantasy league standings.
import Link from "next/link";
import {
  getDemoLeague,
  parseScoring,
  proLeaderboard,
  computeStandings,
} from "@/lib/fantasy";
import { getViewState } from "@/lib/view";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const view = await getViewState();
  if (!view) return <p>No data ingested yet.</p>;
  const league = await getDemoLeague();
  const cfg = parseScoring(league?.scoringConfig);
  const pros = await proLeaderboard(view.tournamentId, cfg, view.cutoff);
  const result = await computeStandings(view.cutoff);

  return (
    <>
      <h1>Leaderboard</h1>
      {view.completedWeek !== null && (
        <p className="muted small">
          Fantasy totals include commissioner-published weeks only. The data-view cursor
          controls the pro-player table below.
        </p>
      )}

      {result && (
        <>
          <h2>Fantasy standings</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Participant</th>
                  <th>Team name</th>
                  <th className="num">Roster</th>
                  <th className="num">Pickems</th>
                  <th className="num">Crystal Ball</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {result.standings.map((s, i) => (
                  <tr key={s.fantasyTeamId}>
                    <td>{i + 1}</td>
                    <td>
                      <Link href={`/participants/${s.fantasyTeamId}`}>{s.username}</Link>
                    </td>
                    <td>{s.teamName}</td>
                    <td className="num">{s.rosterTotal}</td>
                    <td className="num">{s.pickemTotal}</td>
                    <td className="num">{s.crystalBallTotal}</td>
                    <td className="num">
                      <b>{s.total}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Pro players by fantasy points</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Team</th>
              <th>Role</th>
              <th className="num">Games</th>
              <th>K / D / A</th>
              <th className="num">Points</th>
              <th className="num">Pts / game</th>
            </tr>
          </thead>
          <tbody>
            {pros.map((p, i) => (
              <tr key={p.id}>
                <td>{i + 1}</td>
                <td>{p.name}</td>
                <td>{p.team}</td>
                <td className="muted">{p.role}</td>
                <td className="num">{p.games}</td>
                <td>
                  {p.k} / {p.d} / {p.a}
                </td>
                <td className="num">
                  <b>{p.pts.toFixed(1)}</b>
                </td>
                <td className="num">{(p.pts / p.games).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
