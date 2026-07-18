import Link from "next/link";
import { requireLeagueManager } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DRAFT_ROLES, snakeTeamId, totalDraftPicks } from "@/lib/draft";
import DraftBoard from "./DraftBoard";
import { resetDraft, startDraft } from "./actions";

export const dynamic = "force-dynamic";

export default async function DraftPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const access = await requireLeagueManager();
  const feedback = await searchParams;
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: access.league.id },
    include: {
      fantasyTeams: { orderBy: { id: "asc" }, include: { user: true, draftPicks: { orderBy: { overallPick: "asc" }, include: { player: { include: { tournamentRosters: { where: { tournamentId: access.league.tournamentId } } } } } } } },
    },
  });
  if (league.currentWeek !== 0 || league.seasonStatus !== "PRESEASON") return <><p><Link href="/commissioner">← Commissioner</Link></p><h1>Initial roster draft</h1><p className="card">The initial draft is available only during Week 0, before Week 1 is locked.</p></>;
  const order = league.draftOrder ? JSON.parse(league.draftOrder) as number[] : league.fantasyTeams.map((team) => team.id);
  const draftedIds = league.fantasyTeams.flatMap((team) => team.draftPicks.map((pick) => pick.playerId));
  const eligible = await prisma.tournamentPlayer.findMany({
    where: { tournamentId: league.tournamentId, role: { in: [...DRAFT_ROLES] }, playerId: { notIn: draftedIds } },
    include: { player: true }, orderBy: [{ role: "asc" }, { player: { name: "asc" } }],
  });
  const teams = league.fantasyTeams.map((team) => ({
    id: team.id, name: team.name, username: team.user.username,
    picks: team.draftPicks.map((pick) => ({ id: pick.id, playerId: pick.playerId, playerName: pick.player.name, proTeam: pick.player.tournamentRosters[0]?.teamId ?? null, role: pick.role, price: pick.price, overallPick: pick.overallPick })),
  }));
  const totalPicks = totalDraftPicks(teams.length, league.draftPlayersPerRole);
  const currentTeamId = league.draftStatus === "ACTIVE" ? snakeTeamId(order, league.draftCurrentPick) : null;

  return <>
    <p className="small"><Link href="/commissioner">← Commissioner</Link></p>
    <div className="section-heading"><div><h1>Week 0 roster draft</h1><p className="muted">Commissioner-only controls for drafting every participant&apos;s initial roster.</p></div><span className="badge pending">{league.draftStatus.replaceAll("_", " ")}</span></div>
    {feedback.notice && <p className="notice card">{feedback.notice}</p>}
    {feedback.error && <p className="error card">{feedback.error}</p>}
    {league.draftStatus === "NOT_STARTED" ? <section className="card">
      <h2 style={{ marginTop: 0 }}>Set the draft order</h2>
      <p className="muted small">Choose each participant exactly once. This order locks permanently when the first pick becomes available. Starting also clears any manually assigned preseason roster slots.</p>
      <form action={startDraft} className="stack" style={{ maxWidth: 560 }}><input type="hidden" name="leagueId" value={league.id} />
        {teams.map((_, index) => <label key={index}>Pick position {index + 1}<select name="teamId" defaultValue={teams[index]?.id}>{teams.map((team) => <option value={team.id} key={team.id}>{team.username} — {team.name}</option>)}</select></label>)}
        <button type="submit">Lock order and start draft</button>
      </form>
    </section> : <>
      <DraftBoard leagueId={league.id} status={league.draftStatus} currentPick={league.draftCurrentPick} totalPicks={totalPicks} currentTeamId={currentTeamId} budget={league.draftBudget} price={league.draftPlayerPrice} playersPerRole={league.draftPlayersPerRole} order={order} teams={teams} availablePlayers={eligible.map((row) => ({ id: row.playerId, name: row.player.name, teamId: row.teamId ?? row.player.teamId, role: row.role! }))} />
      <form action={resetDraft} className="card safety-confirm"><input type="hidden" name="leagueId" value={league.id} /><label><input type="checkbox" name="confirmReset" value="true" required /><span>Clear every draft pick and initial roster in this league.</span></label><button type="submit">Reset draft and choose a new order</button></form>
    </>}
  </>;
}
