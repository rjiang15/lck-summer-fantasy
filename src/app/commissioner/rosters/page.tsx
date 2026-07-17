import { requireLeagueManager } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addRosterSlot, updateRosterSlot } from "../actions";

export const dynamic = "force-dynamic";

const slotRole: Record<string, string | undefined> = { TOP: "Top", JNG: "Jungle", MID: "Mid", BOT: "Bot", SUP: "Support" };
const requiredSlots = ["TOP", "JNG", "MID", "BOT", "SUP"];

export default async function RostersPage() {
  const access = await requireLeagueManager();
  const league = await prisma.league.findUnique({ where: { id: access.league.id },
    include: { fantasyTeams: { orderBy: { id: "asc" }, include: { user: true, roster: { include: { player: true } } } } },
  });
  if (!league) return <p>No league exists.</p>;
  const eligibleRows = await prisma.tournamentPlayer.findMany({
    where: { tournamentId: league.tournamentId }, include: { player: true }, orderBy: [{ role: "asc" }, { player: { name: "asc" } }],
  });
  const players = eligibleRows.map((row) => ({ ...row.player, role: row.role ?? row.player.role, teamId: row.teamId ?? row.player.teamId }));
  return (
    <>
      <h1>Future rosters</h1>
      <p className="muted small">Changes affect the current and future unlocked weeks. Every locked week keeps its own immutable snapshot.</p>
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
                  <select name="playerId">{eligible.map((player) => <option value={player.id} key={player.id}>{player.name} — {player.teamId}</option>)}</select>
                  <button type="submit">Assign</button>
                </form>;
              }
              const role = slotRole[slot.slot];
              const eligible = players.filter((p) => !role || slot.slot === "BENCH" || p.role === role);
              return (
                <form action={updateRosterSlot} className="roster-row" key={slot.id}>
                  <b>{slot.slot}</b><input type="hidden" name="rosterSlotId" value={slot.id} />
                  <select name="playerId" defaultValue={slot.playerId}>
                    {eligible.map((player) => <option value={player.id} key={player.id}>{player.name} — {player.teamId}</option>)}
                  </select>
                  <button type="submit">Change</button>
                </form>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}
