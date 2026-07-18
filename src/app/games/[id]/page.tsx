// Game detail: full scoreboard — champions, KDA, CS, gold, damage, vision,
// team objectives, and fantasy points per player.
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseScoring, fmtDate, fmtLength, ROLE_ORDER, round1 } from "@/lib/fantasy";
import { playerGamePoints } from "@/lib/scoring";
import { requireLeagueMember } from "@/lib/auth";
import { ChampionLabel, TeamLabel } from "@/components/GameIdentity";
import { getDataViewState, isFinished } from "@/lib/view";

export const dynamic = "force-dynamic";

export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const access = await requireLeagueMember();
  const view = await getDataViewState(access.league.id);
  const gameId = decodeURIComponent(id);
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      match: true,
      playerStats: { include: { player: true } },
      teamStats: true,
      draftActions: { orderBy: [{ side: "asc" }, { action: "asc" }, { sequence: "asc" }] },
      playerTimeline: { where: { minute: { in: [10, 15, 20, 25] } }, orderBy: { minute: "asc" } },
      events: { orderBy: { timestampMs: "asc" } },
    },
  });
  if (!game || !view || game.match.tournamentId !== view.tournamentId || !isFinished(game.match, view.cutoff)) notFound();

  const cfg = parseScoring(access.league.scoringConfig);

  const sides = [...new Set(game.playerStats.map((p) => p.teamId))];
  const roleIdx = (r: string | null) => {
    const i = ROLE_ORDER.indexOf(r ?? "");
    return i === -1 ? 99 : i;
  };
  const pct = (value: number | null) =>
    value === null ? "—" : `${Math.round(value * 100)}%`;
  const perMinute = (value: number | null) =>
    value === null || !game.lengthSec ? "—" : (value / (game.lengthSec / 60)).toFixed(1);

  return (
    <>
      <p className="small">
        <Link href="/">← all games</Link>
      </p>
      <h1 className="game-title-matchup">
        <TeamLabel name={game.match.team1} size="md" /><em>vs</em><TeamLabel name={game.match.team2} size="md" /><span>— Game {game.gameNumber}</span>
      </h1>
      <p className="muted small">
        {fmtDate(game.playedAt)} · length {fmtLength(game.lengthSec)} · winner{" "}
        {game.winner ? <TeamLabel name={game.winner} size="xs" className="game-winner" /> : "?"} · series{" "}
        {game.match.team1Score}–{game.match.team2Score}
        {game.patch && <> · patch {game.patch}</>}
      </p>

      {game.draftActions.length > 0 && (
        <section>
          <h2>Draft</h2>
          <div className="grid2">
            {(["Blue", "Red"] as const).map((side) => {
              const actions = game.draftActions.filter((a) => a.side === side);
              const team = actions[0]?.teamId ?? side;
              return (
                <div className="card" key={side}>
                  <div className="draft-card-heading"><span className={`side-dot ${side.toLowerCase()}`} />{side} · <TeamLabel name={team} size="sm" /></div>
                  <div className="draft-identity-row"><b>Bans</b><div className="entity-list">{actions.filter((a) => a.action === "BAN").map((a) => <ChampionLabel name={a.champion} size="xs" key={`${a.sequence}:${a.champion}`} />)}{actions.every((a) => a.action !== "BAN") && "—"}</div></div>
                  <div className="draft-identity-row"><b>Picks</b><div className="entity-list">{actions.filter((a) => a.action === "PICK").map((a) => <span className="draft-champion" key={`${a.sequence}:${a.champion}`}><ChampionLabel name={a.champion} size="xs" />{a.role && <small>{a.role}</small>}</span>)}{actions.every((a) => a.action !== "PICK") && "—"}</div></div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {sides.map((teamId) => {
        const ts = game.teamStats.find((t) => t.teamId === teamId);
        const players = game.playerStats
          .filter((p) => p.teamId === teamId)
          .sort((a, b) => roleIdx(a.role) - roleIdx(b.role));
        return (
          <section key={teamId}>
            <h2>
              <TeamLabel name={teamId} size="md" />{" "}
              {ts?.won ? (
                <span className="badge win">win</span>
              ) : (
                <span className="badge loss">loss</span>
              )}
            </h2>
            {ts && (
              <p className="muted small">
                {ts.side && <>{ts.side} side · </>}
                Objectives: {ts.towers ?? "?"} towers · {ts.dragons ?? "?"} dragons
                {ts.cloudDrakes != null && <> ({ts.cloudDrakes} cloud, {ts.infernalDrakes ?? 0} infernal, {ts.mountainDrakes ?? 0} mountain, {ts.oceanDrakes ?? 0} ocean, {ts.hextechDrakes ?? 0} hextech, {ts.chemtechDrakes ?? 0} chemtech, {ts.elderDragons ?? 0} elder)</>}
                {" · "}{ts.barons ?? "?"} barons · {ts.heralds ?? "?"} heralds
                {ts.voidGrubs != null && <> · {ts.voidGrubs} void grubs</>}
                {ts.atakhans != null && <> · {ts.atakhans} Atakhan</>}
                {" · "}{ts.inhibs ?? "?"} inhibitors
              </p>
            )}
            {ts && [ts.firstBlood, ts.firstDragon, ts.firstHerald, ts.firstBaron, ts.firstTower].some((v) => v != null) && (
              <p className="small">
                Firsts:{" "}
                {[
                  ["blood", ts.firstBlood],
                  ["dragon", ts.firstDragon],
                  ["herald", ts.firstHerald],
                  ["baron", ts.firstBaron],
                  ["tower", ts.firstTower],
                ].filter(([, value]) => value).map(([label]) => label).join(" · ") || "none"}
              </p>
            )}
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Player</th>
                    <th>Champion</th>
                    <th>K / D / A</th>
                    <th className="num">CS</th>
                    <th className="num">Gold</th>
                    <th className="num">Damage</th>
                    <th className="num">Vision</th>
                    <th className="num">KDA</th>
                    <th className="num">KP</th>
                    <th className="num">CSΔ</th>
                    <th className="num">GoldΔ</th>
                    <th className="num">DPM</th>
                    <th className="num">Wards P/K</th>
                    <th className="num">Multi</th>
                    <th className="num">Fantasy pts</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => {
                    const opponent = game.playerStats.find(
                      (other) => other.teamId !== p.teamId && other.role === p.role,
                    );
                    const team = game.teamStats.find((t) => t.teamId === p.teamId);
                    const kp = p.killParticipation ??
                      (team?.kills ? (p.kills + p.assists) / team.kills : null);
                    const multi = [
                      p.doubleKills ? `${p.doubleKills}×2` : null,
                      p.tripleKills ? `${p.tripleKills}×3` : null,
                      p.quadraKills ? `${p.quadraKills}×4` : null,
                      p.pentakills ? `${p.pentakills}×5` : null,
                    ].filter(Boolean).join(" ");
                    return <tr key={p.id}>
                      <td className="muted">{p.role ?? "?"}</td>
                      <td>{p.player.name}</td>
                      <td><ChampionLabel name={p.champion} size="sm" /></td>
                      <td>
                        {p.kills} / {p.deaths} / {p.assists}
                      </td>
                      <td className="num">{p.cs ?? "?"}</td>
                      <td className="num">{p.gold?.toLocaleString() ?? "?"}</td>
                      <td className="num">{p.damage?.toLocaleString() ?? "?"}</td>
                      <td className="num">{p.visionScore ?? "?"}</td>
                      <td className="num">{((p.kills + p.assists) / Math.max(1, p.deaths)).toFixed(2)}</td>
                      <td className="num">{pct(kp)}</td>
                      <td className="num">{p.cs != null && opponent?.cs != null ? p.cs - opponent.cs : "—"}</td>
                      <td className="num">{p.gold != null && opponent?.gold != null ? (p.gold - opponent.gold).toLocaleString() : "—"}</td>
                      <td className="num">{perMinute(p.damage)}</td>
                      <td className="num">{p.wardsPlaced != null || p.wardsKilled != null ? `${p.wardsPlaced ?? 0}/${p.wardsKilled ?? 0}` : "—"}</td>
                      <td className="num">{multi || "—"}</td>
                      <td className="num">
                        <b>{round1(playerGamePoints(p, cfg, {
                          lengthSec: game.lengthSec,
                          teamObjectives: team,
                          laneAt15: game.playerTimeline.find((row) => row.playerId === p.playerId && row.minute === 15),
                        }))}</b>
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {game.playerTimeline.length > 0 && (
        <section>
          <h2>Lane checkpoints</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Minute</th><th>Player</th><th className="num">K/D/A</th><th className="num">CS</th><th className="num">CSΔ</th><th className="num">Gold</th><th className="num">GoldΔ</th><th className="num">XPΔ</th></tr></thead>
              <tbody>
                {game.playerTimeline.map((snapshot) => {
                  const player = game.playerStats.find((p) => p.playerId === snapshot.playerId);
                  return <tr key={snapshot.id}>
                    <td>{snapshot.minute}:00</td><td>{player?.player.name ?? snapshot.playerId}</td>
                    <td className="num">{snapshot.kills ?? "—"}/{snapshot.deaths ?? "—"}/{snapshot.assists ?? "—"}</td>
                    <td className="num">{snapshot.cs ?? "—"}</td><td className="num">{snapshot.csDiff ?? "—"}</td>
                    <td className="num">{snapshot.gold?.toLocaleString() ?? "—"}</td><td className="num">{snapshot.goldDiff?.toLocaleString() ?? "—"}</td><td className="num">{snapshot.xpDiff?.toLocaleString() ?? "—"}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {game.events.length > 0 && (
        <p className="muted small">
          Event timeline loaded: {game.events.length} events ({game.events.filter((e) => e.type === "CHAMPION_KILL").length} champion kills).
        </p>
      )}
    </>
  );
}
