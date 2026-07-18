// Settings: backup (export/import) and a look at the data sources & scoring config.
import { getDemoLeague, parseScoring } from "@/lib/fantasy";
import { prisma } from "@/lib/db";
import ImportForm from "@/components/ImportForm";
import { addCommissioner, resetTestLeague, updateMembershipRole } from "./actions";
import { requireLeagueManager } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const access = await requireLeagueManager();
  const feedback = await searchParams;
  const league = await getDemoLeague(access.league.id);
  const cfg = parseScoring(league?.scoringConfig);
  const tournaments = await prisma.tournament.findMany({ orderBy: { id: "asc" } });
  const memberships = await prisma.leagueMembership.findMany({ where: { leagueId: access.league.id }, include: { user: true }, orderBy: [{ role: "asc" }, { joinedAt: "asc" }] });

  return (
    <>
      <h1>Settings</h1>
      {feedback.notice && <p className="notice card">{feedback.notice}</p>}
      {feedback.error && <p className="error card">{feedback.error}</p>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>League identity</h2>
        <p><b>{league?.name}</b> · {league?.isSimulation ? "Test / simulation" : "Live"}</p>
        <p className="small muted">Invite code: <code>{league?.inviteCode}</code> · Share this with participants. This league&apos;s fantasy data and week progress are independent from every other league.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>People and permissions</h2>
        <p className="small muted">Owners control roles. Commissioners can run the weekly pipeline, manage rosters, scoring, and grading. A commissioner account is still a normal account and can commission multiple leagues.</p>
        <div className="tablewrap"><table><thead><tr><th>User</th><th>Role</th><th>Fantasy team</th><th>Change</th></tr></thead><tbody>{memberships.map((membership) => {
          const team = league?.fantasyTeams.find((row) => row.userId === membership.userId);
          return <tr key={membership.id}><td>{membership.user.username}</td><td>{membership.role}</td><td>{team?.name ?? "—"}</td><td>{access.membership.role === "OWNER" && membership.role !== "OWNER" ? <form action={updateMembershipRole} className="inline-form"><input type="hidden" name="leagueId" value={access.league.id} /><input type="hidden" name="membershipId" value={membership.id} /><select name="role" defaultValue={membership.role}><option value="PARTICIPANT">Participant</option><option value="COMMISSIONER">Commissioner</option></select><button type="submit">Save</button></form> : <span className="muted small">Owner only</span>}</td></tr>;
        })}</tbody></table></div>
        {access.membership.role === "OWNER" && <form action={addCommissioner} className="stack" style={{ maxWidth: 520, marginTop: "1rem" }}>
          <h3>Add a commissioner</h3><input type="hidden" name="leagueId" value={access.league.id} />
          <label>Username <input name="username" required minLength={3} maxLength={24} /></label>
          <label>Temporary password <input name="temporaryPassword" type="password" minLength={10} placeholder="Only required for a new account" /></label>
          <button type="submit">Grant commissioner access</button>
        </form>}
      </div>

      {league?.isSimulation && access.membership.role === "OWNER" && <div className="card">
        <h2 style={{ marginTop: 0 }}>Test controls</h2><p className="small muted">Reset only this test league to Week 0. It clears its snake draft, rosters, picks, Crystal Ball answers, snapshots, and scores while preserving members, fantasy teams, and all shared LCK data.</p>
        <form action={resetTestLeague} className="safety-confirm"><input type="hidden" name="leagueId" value={league.id} /><label><input type="checkbox" name="confirmReset" value="true" required /><span>Clear the draft, rosters, picks, Crystal Ball answers, and weekly scores for this test league.</span></label><button type="submit">Reset this test league</button></form>
      </div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Backup</h2>
        <p className="small muted">
          The backup contains the fantasy side only: league config, users, rosters,
          pickems, crystal ball, weekly roster snapshots, and published scores. Game data
          always re-ingests from the sources, so it isn&apos;t included. Importing replaces
          everything in the backup&apos;s scope.
        </p>
        <p>
          <a href={`/api/export?leagueId=${league?.id}`}>⬇ Export this league (JSON)</a>
        </p>
        {league && access.membership.role === "OWNER" && <ImportForm leagueId={league.id} />}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Ingested data</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Tournament</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="muted">
                    {t.id.startsWith("OE:") ? "Oracle's Elixir CSV" : "Leaguepedia API"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Leaguepedia schedule and result pulls are available from the <a href="/commissioner">Commissioner data pipeline</a>.
          Oracle&apos;s Elixir enrichment remains an optional advanced import: <code>npm run ingest:oe -- &lt;csv&gt; &quot;&lt;split&gt;&quot; --week=1</code>.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Scoring config (league: {league?.name ?? "none"})</h2>
        <p className="small muted">
          Stored as JSON on the league and editable on the Commissioner page until the
          first week is published. Published weekly scores remain immutable snapshots.
        </p>
        <pre className="card small" style={{ overflowX: "auto" }}>
          {JSON.stringify(cfg, null, 2)}
        </pre>
      </div>
    </>
  );
}
