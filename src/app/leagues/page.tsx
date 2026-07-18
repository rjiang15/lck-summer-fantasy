import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteRecoveryCheckpoint, restoreDeletedLeague } from "./actions";

export default async function LeaguesPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const user = await requireUser();
  const feedback = await searchParams;
  const memberships = await prisma.leagueMembership.findMany({
    where: { userId: user.id },
    include: { league: { include: { fantasyTeams: { where: { userId: user.id } } } } },
    orderBy: { joinedAt: "asc" },
  });
  const tournamentIds = [...new Set(memberships.map((membership) => membership.league.tournamentId))];
  const tournamentCatalog = new Map((await prisma.tournament.findMany({
    where: { id: { in: tournamentIds } },
    select: { id: true, name: true, catalogStatus: true },
  })).map((tournament) => [tournament.id, tournament]));
  const recoveryBackups = await prisma.leagueBackup.findMany({
    where: { ownerUserId: user.id, sourceDeletedAt: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  const restoredIds = [...new Set(recoveryBackups.map((backup) => backup.restoredLeagueId).filter((id): id is number => id !== null))];
  const restoredLeagues = new Map((await prisma.league.findMany({ where: { id: { in: restoredIds } }, select: { id: true, slug: true, name: true } })).map((league) => [league.id, league]));
  return <>
    <div className="section-heading"><div><h1>My leagues</h1><p className="muted">Switch between independent live and test leagues that share the same LCK source data.</p></div><Link className="button-link" href="/leagues/new">＋ Create league</Link></div>
    {feedback.notice && <p className="notice card">{feedback.notice}</p>}
    {feedback.error && <p className="error card">{feedback.error}</p>}
    {memberships.length === 0 ? <section className="card empty-state"><h2>No leagues yet</h2><p>Create a league as its owner, or join one using a commissioner&apos;s invite code.</p><div className="inline-form"><Link href="/leagues/new">Create a league</Link><Link href="/join">Join with a code</Link></div></section> :
      <div className="card-grid">{memberships.map(({ league, role }) => <section className="card" key={league.id}>
        <div className="section-heading"><h2 style={{ margin: 0 }}>{league.name}</h2><span className="badge pending">{role}</span></div>
        <p className="small muted">{tournamentCatalog.get(league.tournamentId)?.name ?? league.tournamentId}<br />{tournamentCatalog.get(league.tournamentId)?.catalogStatus === "CURRENT" ? "Current season" : "Past season"} · {league.isSimulation ? "Test / simulation" : "Live league"} · {league.seasonStatus} · after Week {league.currentWeek}</p>
        {league.fantasyTeams[0] && <p>Your team: <b>{league.fantasyTeams[0].name}</b></p>}
        <a href={`/api/league/select?slug=${encodeURIComponent(league.slug)}&back=/`}>Open league →</a>
      </section>)}</div>}
    {recoveryBackups.length > 0 && <section className="card stack">
      <div><h2 style={{ marginBottom: "0.25rem" }}>Deleted league recovery</h2><p className="small muted">These checkpoints survive league deletion. Restore any saved point as a new league with a new invite code, download it, or permanently purge it.</p></div>
      <div className="tablewrap"><table><thead><tr><th>League</th><th>Saved point</th><th>Created</th><th>Status</th><th>Actions</th></tr></thead><tbody>{recoveryBackups.map((backup) => {
        const restored = backup.restoredLeagueId ? restoredLeagues.get(backup.restoredLeagueId) : undefined;
        return <tr key={backup.id}><td>{backup.originalLeagueName}</td><td>{backup.label}</td><td>{backup.createdAt.toLocaleString("en-US")}</td><td>{restored ? <>Restored as <a href={`/api/league/select?slug=${encodeURIComponent(restored.slug)}&back=/settings`}>{restored.name}</a></> : "Available"}</td><td><div className="stack compact-actions">
          <a href={`/api/backups/${backup.id}`}>Download JSON</a>
          {!restored && <form action={restoreDeletedLeague} className="safety-confirm"><input type="hidden" name="backupId" value={backup.id} /><label><input type="checkbox" name="confirmRestore" value="true" required /><span>Restore this point as a new league.</span></label><button type="submit">Restore league</button></form>}
          <form action={deleteRecoveryCheckpoint} className="safety-confirm"><input type="hidden" name="backupId" value={backup.id} /><label><input type="checkbox" name="confirmDeleteBackup" value="true" required /><span>Permanently purge this checkpoint.</span></label><button type="submit">Delete checkpoint</button></form>
        </div></td></tr>;
      })}</tbody></table></div>
    </section>}
    <p className="muted small">Have an invite? <Link href="/join">Join another league</Link>.</p>
  </>;
}
