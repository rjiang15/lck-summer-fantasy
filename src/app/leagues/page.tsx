import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function LeaguesPage() {
  const user = await requireUser();
  const memberships = await prisma.leagueMembership.findMany({
    where: { userId: user.id },
    include: { league: { include: { fantasyTeams: { where: { userId: user.id } } } } },
    orderBy: { joinedAt: "asc" },
  });
  return <>
    <div className="section-heading"><div><h1>My leagues</h1><p className="muted">Switch between independent live and test leagues that share the same LCK source data.</p></div><Link className="button-link" href="/leagues/new">＋ Create league</Link></div>
    {memberships.length === 0 ? <section className="card empty-state"><h2>No leagues yet</h2><p>Create a league as its owner, or join one using a commissioner&apos;s invite code.</p><div className="inline-form"><Link href="/leagues/new">Create a league</Link><Link href="/join">Join with a code</Link></div></section> :
      <div className="card-grid">{memberships.map(({ league, role }) => <section className="card" key={league.id}>
        <div className="section-heading"><h2 style={{ margin: 0 }}>{league.name}</h2><span className="badge pending">{role}</span></div>
        <p className="small muted">{league.tournamentId}<br />{league.isSimulation ? "Test / simulation" : "Live league"} · {league.seasonStatus} · after Week {league.currentWeek}</p>
        {league.fantasyTeams[0] && <p>Your team: <b>{league.fantasyTeams[0].name}</b></p>}
        <a href={`/api/league/select?slug=${encodeURIComponent(league.slug)}&back=/`}>Open league →</a>
      </section>)}</div>}
    <p className="muted small">Have an invite? <Link href="/join">Join another league</Link>.</p>
  </>;
}
