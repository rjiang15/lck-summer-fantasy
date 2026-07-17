// Deep statistical explorer: player performance, champion meta, and team macro.
import { prisma } from "@/lib/db";
import { getViewState } from "@/lib/view";
import { ChampionLabel, TeamLabel } from "@/components/GameIdentity";

export const dynamic = "force-dynamic";

const pct = (part: number, total: number) =>
  total === 0 ? "—" : `${((part / total) * 100).toFixed(1)}%`;

const perGame = (value: number, games: number) =>
  games === 0 ? "—" : (value / games).toFixed(1);

export default async function StatsPage() {
  const view = await getViewState();
  if (!view) return <p>No data ingested yet.</p>;
  const games = await prisma.game.findMany({
    where: {
      match: {
        tournamentId: view.tournamentId,
        ...(view.cutoff ? { scheduledAt: { lt: view.cutoff } } : {}),
      },
    },
    include: {
      playerStats: { include: { player: true } },
      teamStats: true,
      draftActions: true,
    },
  });

  const players = new Map<string, {
    name: string; team: string; role: string; games: number; wins: number;
    kills: number; deaths: number; assists: number; cs: number; damage: number;
    vision: number; pentas: number; wardsPlaced: number; wardsKilled: number;
    kpTotal: number; kpSamples: number;
  }>();
  const champions = new Map<string, { picks: number; wins: number; bans: number }>();
  const teams = new Map<string, {
    games: number; wins: number; kills: number; towers: number; dragons: number;
    barons: number; heralds: number; voidGrubs: number; atakhans: number;
    firstBloods: number; firstDragons: number; firstBarons: number; firstTowers: number;
  }>();

  for (const game of games) {
    for (const stat of game.playerStats) {
      const row = players.get(stat.playerId) ?? {
        name: stat.player.name, team: stat.teamId, role: stat.role ?? "?", games: 0,
        wins: 0, kills: 0, deaths: 0, assists: 0, cs: 0, damage: 0, vision: 0,
        pentas: 0, wardsPlaced: 0, wardsKilled: 0, kpTotal: 0, kpSamples: 0,
      };
      row.games++;
      row.wins += stat.won ? 1 : 0;
      row.kills += stat.kills;
      row.deaths += stat.deaths;
      row.assists += stat.assists;
      row.cs += stat.cs ?? 0;
      row.damage += stat.damage ?? 0;
      row.vision += stat.visionScore ?? 0;
      row.pentas += stat.pentakills ?? 0;
      row.wardsPlaced += stat.wardsPlaced ?? 0;
      row.wardsKilled += stat.wardsKilled ?? 0;
      if (stat.killParticipation != null) {
        row.kpTotal += stat.killParticipation;
        row.kpSamples++;
      }
      row.team = stat.teamId;
      players.set(stat.playerId, row);

      const champion = champions.get(stat.champion) ?? { picks: 0, wins: 0, bans: 0 };
      champion.picks++;
      champion.wins += stat.won ? 1 : 0;
      champions.set(stat.champion, champion);
    }
    for (const action of game.draftActions) {
      if (action.action !== "BAN") continue;
      const champion = champions.get(action.champion) ?? { picks: 0, wins: 0, bans: 0 };
      champion.bans++;
      champions.set(action.champion, champion);
    }
    for (const stat of game.teamStats) {
      const row = teams.get(stat.teamId) ?? {
        games: 0, wins: 0, kills: 0, towers: 0, dragons: 0, barons: 0,
        heralds: 0, voidGrubs: 0, atakhans: 0, firstBloods: 0, firstDragons: 0,
        firstBarons: 0, firstTowers: 0,
      };
      row.games++;
      row.wins += stat.won ? 1 : 0;
      row.kills += stat.kills ?? 0;
      row.towers += stat.towers ?? 0;
      row.dragons += stat.dragons ?? 0;
      row.barons += stat.barons ?? 0;
      row.heralds += stat.heralds ?? 0;
      row.voidGrubs += stat.voidGrubs ?? 0;
      row.atakhans += stat.atakhans ?? 0;
      row.firstBloods += stat.firstBlood ? 1 : 0;
      row.firstDragons += stat.firstDragon ? 1 : 0;
      row.firstBarons += stat.firstBaron ? 1 : 0;
      row.firstTowers += stat.firstTower ? 1 : 0;
      teams.set(stat.teamId, row);
    }
  }

  const playerRows = [...players.values()].sort(
    (a, b) => (b.kills + b.assists) / Math.max(1, b.deaths) - (a.kills + a.assists) / Math.max(1, a.deaths),
  );
  const championRows = [...champions.entries()].sort(
    (a, b) => b[1].picks + b[1].bans - (a[1].picks + a[1].bans),
  );
  const teamRows = [...teams.entries()].sort((a, b) => b[1].wins - a[1].wins);

  return <>
    <h1>Deep stats</h1>
    <p className="muted small">
      {view.tournamentName} · {games.length} games. Blank advanced fields mean the selected source did not publish that metric; raw source rows are retained for future parsers.
    </p>

    <h2>Players</h2>
    <div className="tablewrap"><table>
      <thead><tr><th>Player</th><th>Team</th><th>Role</th><th className="num">GP</th><th className="num">Win%</th><th className="num">KDA</th><th className="num">KP</th><th className="num">CS/G</th><th className="num">Dmg/G</th><th className="num">Vision/G</th><th className="num">Wards P/K</th><th className="num">Pentas</th></tr></thead>
      <tbody>{playerRows.map((p) => <tr key={`${p.name}:${p.team}`}>
        <td>{p.name}</td><td><TeamLabel name={p.team} size="xs" /></td><td>{p.role}</td><td className="num">{p.games}</td>
        <td className="num">{pct(p.wins, p.games)}</td><td className="num">{((p.kills + p.assists) / Math.max(1, p.deaths)).toFixed(2)}</td>
        <td className="num">{p.kpSamples ? `${((p.kpTotal / p.kpSamples) * 100).toFixed(1)}%` : "—"}</td>
        <td className="num">{perGame(p.cs, p.games)}</td><td className="num">{perGame(p.damage, p.games)}</td><td className="num">{perGame(p.vision, p.games)}</td>
        <td className="num">{p.wardsPlaced || p.wardsKilled ? `${p.wardsPlaced}/${p.wardsKilled}` : "—"}</td><td className="num">{p.pentas}</td>
      </tr>)}</tbody>
    </table></div>

    <h2>Champion meta</h2>
    <div className="tablewrap"><table>
      <thead><tr><th>Champion</th><th className="num">Picks</th><th className="num">Bans</th><th className="num">Presence</th><th className="num">Wins</th><th className="num">Pick win%</th></tr></thead>
      <tbody>{championRows.map(([champion, row]) => <tr key={champion}>
        <td><ChampionLabel name={champion} size="sm" /></td><td className="num">{row.picks}</td><td className="num">{row.bans}</td><td className="num">{row.picks + row.bans}</td><td className="num">{row.wins}</td><td className="num">{pct(row.wins, row.picks)}</td>
      </tr>)}</tbody>
    </table></div>

    <h2>Team macro</h2>
    <div className="tablewrap"><table>
      <thead><tr><th>Team</th><th className="num">GP</th><th className="num">Win%</th><th className="num">Kills/G</th><th className="num">Towers/G</th><th className="num">Dragons/G</th><th className="num">Barons/G</th><th className="num">Heralds/G</th><th className="num">Grubs/G</th><th className="num">Atakhan/G</th><th className="num">First blood</th><th className="num">First dragon</th><th className="num">First baron</th><th className="num">First tower</th></tr></thead>
      <tbody>{teamRows.map(([team, row]) => <tr key={team}>
        <td><TeamLabel name={team} size="sm" /></td><td className="num">{row.games}</td><td className="num">{pct(row.wins, row.games)}</td>
        <td className="num">{perGame(row.kills, row.games)}</td><td className="num">{perGame(row.towers, row.games)}</td><td className="num">{perGame(row.dragons, row.games)}</td><td className="num">{perGame(row.barons, row.games)}</td><td className="num">{perGame(row.heralds, row.games)}</td><td className="num">{perGame(row.voidGrubs, row.games)}</td><td className="num">{perGame(row.atakhans, row.games)}</td>
        <td className="num">{pct(row.firstBloods, row.games)}</td><td className="num">{pct(row.firstDragons, row.games)}</td><td className="num">{pct(row.firstBarons, row.games)}</td><td className="num">{pct(row.firstTowers, row.games)}</td>
      </tr>)}</tbody>
    </table></div>
  </>;
}
