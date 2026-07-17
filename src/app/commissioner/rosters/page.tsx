import { requireLeagueManager } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addRosterSlot, updateRosterSlot } from "../actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

const slotRole: Record<string, string | undefined> = { TOP: "Top", JNG: "Jungle", MID: "Mid", BOT: "Bot", SUP: "Support" };
const requiredSlots = ["TOP", "JNG", "MID", "BOT", "SUP"];

export default async function RostersPage() {
  const access = await requireLeagueManager();
  const league = await prisma.league.findUnique({ where: { id: access.league.id },
    include: { fantasyTeams: { orderBy: { id: "asc" }, include: { user: true, roster: { include: { player: true } } } } },
  });
  if (!league) return <p>No league exists.</p>;
  if (league.currentWeek === 0) return <><h1>Future rosters</h1><p className="card">Initial rosters are built through the commissioner-run <Link href="/commissioner/draft">Week 0 snake draft</Link>. Manual roster changes begin after Week 1.</p></>;
  const eligibleRows = await prisma.tournamentPlayer.findMany({
    where: { tournamentId: league.tournamentId }, include: { player: true }, orderBy: [{ role: "asc" }, { player: { name: "asc" } }],
  });
  const players = eligibleRows.map((row) => ({ ...row.player, role: row.role ?? row.player.role, teamId: row.teamId ?? row.player.teamId }));
  return (
    <>
      <h1>Future rosters</h1>
      <p className="muted small">
        Roster editing is <b>{league.rostersLockedAt ? "locked" : "open"}</b>. Changes affect future weekly snapshots only; frozen weeks and published scores never change.
      </p>
      {league.rostersLockedAt && <p className="card">Unlock roster editing from the <Link href="/commissioner">Commissioner page</Link> before making changes.</p>}
      {players.length === 0 && (
        <p className="card">The player pool is empty. Run the Week 1 Leaguepedia ingest from the Commissioner page first; tournament rosters are imported even before games are played.</p>
      )}
      <div className="grid2">
        {league.fantasyTeams.map((team) => (
          <section className="card" key={team.id}>
            <h2 style={{ marginTop: 0 }}>{team.name} <span className="muted small">{team.user.username}</span></h2>
            {requiredSlots.map((slotName) => {
              const slot = team.roster.find((row) => row.slot === slotName);
              if (!slot) {
                const eligible = players.filter((player) => player.role === slotRole[slotName]);
                return <form action={addRosterSlot} className="roster-row" key={slotName}>
                  <b>{slotName}</b><input type="hidden" name="fantasyTeamId" value={team.id} /><input type="hidden" name="slot" value={slotName} />
                  <select name="playerId" disabled={Boolean(league.rostersLockedAt)}>{eligible.map((player) => <option value={player.id} key={player.id}>{player.name} — {player.teamId}</option>)}</select>
                  <button type="submit" disabled={Boolean(league.rostersLockedAt)}>Assign</button>
                </form>;
              }
              const role = slotRole[slot.slot];
              const eligible = players.filter((p) => !role || slot.slot === "BENCH" || p.role === role);
              return (
                <form action={updateRosterSlot} className="roster-row" key={slot.id}>
                  <b>{slot.slot}</b><input type="hidden" name="rosterSlotId" value={slot.id} />
                  <select name="playerId" defaultValue={slot.playerId} disabled={Boolean(league.rostersLockedAt)}>
                    {eligible.map((player) => <option value={player.id} key={player.id}>{player.name} — {player.teamId}</option>)}
                  </select>
                  <button type="submit" disabled={Boolean(league.rostersLockedAt)}>Change</button>
                </form>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}
