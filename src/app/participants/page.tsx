// Participants index: link to each participant's personal page.
import Link from "next/link";
import { getDemoLeague, computeStandings } from "@/lib/fantasy";
import { getViewState } from "@/lib/view";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ParticipantsPage() {
  const league = await getDemoLeague();
  if (!league) return <p>No league set up yet. Run the seed script.</p>;
  const view = await getViewState();
  const result = await computeStandings(view?.cutoff ?? null);
  const viewer = await getCurrentUser();
  const isMember = viewer ? league.fantasyTeams.some((team) => team.userId === viewer.id) : false;

  return (
    <>
      <h1>{league.name}</h1>
      {isMember && <p className="muted small">Invite code: {league.inviteCode}</p>}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Participant</th>
              <th>Team name</th>
              <th className="num">Total points</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(result?.standings ?? []).map((s) => (
              <tr key={s.fantasyTeamId}>
                <td>{s.username}</td>
                <td>{s.teamName}</td>
                <td className="num">
                  <b>{s.total}</b>
                </td>
                <td>
                  <Link href={`/participants/${s.fantasyTeamId}`}>view page →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
