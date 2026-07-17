import Link from "next/link";
import { prisma } from "@/lib/db";
import { getViewState } from "@/lib/view";
import { ChampionMetaTable, PlayerLeaderTable, TeamMacroTable } from "./MacroTables";

export const dynamic = "force-dynamic";

type PlayerRollup = {
  id: string;
  name: string;
  team: string;
  role: string;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  vision: number;
  pentas: number;
  champions: Set<string>;
};

type ChampionRollup = {
  picks: number;
  wins: number;
  bans: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
};

type TeamRollup = {
  games: number;
  wins: number;
  kills: number;
  gold: number;
  towers: number;
  dragons: number;
  elders: number;
  barons: number;
  heralds: number;
  grubs: number;
  atakhans: number;
  inhibitors: number;
};

const pct = (part: number, total: number) => total === 0 ? "—" : `${((part / total) * 100).toFixed(1)}%`;
const perGame = (value: number, games: number) => games === 0 ? "—" : (value / games).toFixed(1);
const kda = (kills: number, deaths: number, assists: number) => (kills + assists) / Math.max(1, deaths);
const duration = (seconds: number | null) => {
  if (seconds == null) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export default async function MacroDashboardPage() {
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
      match: true,
      playerStats: { include: { player: true } },
      teamStats: true,
      draftActions: true,
    },
    orderBy: [{ playedAt: "asc" }, { id: "asc" }],
  });

  if (games.length === 0) {
    return <div className="card empty-state"><h1>Macro dashboard</h1><p className="muted">No completed games are available for this view yet.</p></div>;
  }

  const players = new Map<string, PlayerRollup>();
  const champions = new Map<string, ChampionRollup>();
  const teams = new Map<string, TeamRollup>();

  for (const game of games) {
    for (const stat of game.playerStats) {
      const player = players.get(stat.playerId) ?? {
        id: stat.playerId,
        name: stat.player.name,
        team: stat.teamId,
        role: stat.role ?? stat.player.role ?? "?",
        games: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        damage: 0,
        vision: 0,
        pentas: 0,
        champions: new Set<string>(),
      };
      player.games++;
      player.wins += stat.won ? 1 : 0;
      player.kills += stat.kills;
      player.deaths += stat.deaths;
      player.assists += stat.assists;
      player.cs += stat.cs ?? 0;
      player.damage += stat.damage ?? 0;
      player.vision += stat.visionScore ?? 0;
      player.pentas += stat.pentakills ?? 0;
      player.team = stat.teamId;
      if (stat.champion) player.champions.add(stat.champion);
      players.set(stat.playerId, player);

      if (stat.champion) {
        const champion = champions.get(stat.champion) ?? {
          picks: 0, wins: 0, bans: 0, kills: 0, deaths: 0, assists: 0, damage: 0,
        };
        champion.picks++;
        champion.wins += stat.won ? 1 : 0;
        champion.kills += stat.kills;
        champion.deaths += stat.deaths;
        champion.assists += stat.assists;
        champion.damage += stat.damage ?? 0;
        champions.set(stat.champion, champion);
      }
    }

    for (const action of game.draftActions) {
      if (action.action !== "BAN" || !action.champion) continue;
      const champion = champions.get(action.champion) ?? {
        picks: 0, wins: 0, bans: 0, kills: 0, deaths: 0, assists: 0, damage: 0,
      };
      champion.bans++;
      champions.set(action.champion, champion);
    }

    for (const stat of game.teamStats) {
      const team = teams.get(stat.teamId) ?? {
        games: 0, wins: 0, kills: 0, gold: 0, towers: 0, dragons: 0,
        elders: 0, barons: 0, heralds: 0, grubs: 0, atakhans: 0, inhibitors: 0,
      };
      team.games++;
      team.wins += stat.won ? 1 : 0;
      team.kills += stat.kills ?? 0;
      team.gold += stat.gold ?? 0;
      team.towers += stat.towers ?? 0;
      team.dragons += stat.dragons ?? 0;
      team.elders += stat.elderDragons ?? 0;
      team.barons += stat.barons ?? 0;
      team.heralds += stat.heralds ?? 0;
      team.grubs += stat.voidGrubs ?? 0;
      team.atakhans += stat.atakhans ?? 0;
      team.inhibitors += stat.inhibs ?? 0;
      teams.set(stat.teamId, team);
    }
  }

  const playerRows = [...players.values()];
  const championRows = [...champions.entries()];
  const teamRows = [...teams.entries()].sort((a, b) => b[1].wins - a[1].wins || b[1].kills - a[1].kills);
  const completedLengths = games.flatMap((game) => game.lengthSec == null ? [] : [game.lengthSec]);
  const totalKills = playerRows.reduce((sum, player) => sum + player.kills, 0);
  const averageLength = completedLengths.length > 0
    ? Math.round(completedLengths.reduce((sum, value) => sum + value, 0) / completedLengths.length)
    : null;
  const gameRecords = games.map((game) => ({
    id: game.id,
    winner: game.winner,
    loser: game.winner === game.match.team1 ? game.match.team2 : game.match.team1,
    team1: game.match.team1,
    team2: game.match.team2,
    lengthSec: game.lengthSec,
    kills: game.playerStats.reduce((sum, stat) => sum + stat.kills, 0),
  }));
  const fastestGames = [...gameRecords].filter((game) => game.winner && game.lengthSec != null).sort((a, b) => a.lengthSec! - b.lengthSec!).slice(0, 5);
  const bloodiestGames = [...gameRecords].sort((a, b) => b.kills - a.kills || (a.lengthSec ?? Infinity) - (b.lengthSec ?? Infinity)).slice(0, 5);

  const mostPicked = maxBy(championRows, ([, row]) => row.picks);
  const mostBanned = maxBy(championRows, ([, row]) => row.bans);
  const mostKillsChampion = maxBy(championRows, ([, row]) => row.kills);
  const winRateMinimum = Math.max(3, Math.ceil(games.length * 0.08));
  const bestWinRate = maxBy(championRows.filter(([, row]) => row.picks >= winRateMinimum), ([, row]) => row.wins / row.picks);
  const highestKda = maxBy(playerRows, (player) => kda(player.kills, player.deaths, player.assists));
  const highestCs = maxBy(playerRows, (player) => player.cs / player.games);
  const highestDamage = maxBy(playerRows, (player) => player.damage / player.games);
  const widestPool = maxBy(playerRows, (player) => player.champions.size);

  const cards = [
    mostPicked && { label: "Most picked", value: mostPicked[0], detail: `${mostPicked[1].picks} picks · ${pct(mostPicked[1].picks, games.length)} of games` },
    mostBanned && { label: "Most banned", value: mostBanned[0], detail: `${mostBanned[1].bans} bans · ${pct(mostBanned[1].bans, games.length)} of games` },
    bestWinRate && { label: `Best win rate (${winRateMinimum}+ picks)`, value: bestWinRate[0], detail: `${pct(bestWinRate[1].wins, bestWinRate[1].picks)} · ${bestWinRate[1].wins}-${bestWinRate[1].picks - bestWinRate[1].wins}` },
    mostKillsChampion && { label: "Most champion kills", value: mostKillsChampion[0], detail: `${mostKillsChampion[1].kills} kills across ${mostKillsChampion[1].picks} picks` },
    highestKda && { label: "Highest player KDA", value: highestKda.name, detail: `${kda(highestKda.kills, highestKda.deaths, highestKda.assists).toFixed(2)} KDA · ${highestKda.games} games` },
    highestCs && { label: "Highest CS per game", value: highestCs.name, detail: `${perGame(highestCs.cs, highestCs.games)} CS/G · ${highestCs.team}` },
    highestDamage && { label: "Highest damage per game", value: highestDamage.name, detail: `${Math.round(highestDamage.damage / highestDamage.games).toLocaleString()} Dmg/G · ${highestDamage.team}` },
    widestPool && { label: "Widest champion pool", value: widestPool.name, detail: `${widestPool.champions.size} champions in ${widestPool.games} games` },
  ].filter((card): card is { label: string; value: string; detail: string } => Boolean(card));

  const sortableTeamRows = teamRows.map(([team, row]) => ({ team, ...row }));
  const sortableChampionRows = championRows.map(([champion, row]) => ({ champion, ...row }));
  const sortablePlayerRows = playerRows.map((player) => ({ ...player, champions: [...player.champions].sort() }));

  return <div className="macro-dashboard">
    <header className="macro-hero">
      <div>
        <span className="macro-eyebrow">Season intelligence</span>
        <h1>Macro dashboard</h1>
        <p>{view.tournamentName} · {view.isLive ? "Live view" : `Through Week ${view.completedWeek}`} · game, draft, objective, champion and player records.</p>
      </div>
      <Link href="/stats" className="button-link">Open player stat table</Link>
    </header>

    <section className="macro-kpis" aria-label="Season snapshot">
      <Kpi label="Games played" value={games.length.toLocaleString()} detail={`${teams.size} teams`} />
      <Kpi label="Average game" value={duration(averageLength)} detail={`${duration(completedLengths.length > 0 ? Math.min(...completedLengths) : null)} shortest`} />
      <Kpi label="Total kills" value={totalKills.toLocaleString()} detail={`${perGame(totalKills, games.length)} per game`} />
      <Kpi label="Champions picked" value={championRows.filter(([, row]) => row.picks > 0).length.toLocaleString()} detail={`${championRows.reduce((sum, [, row]) => sum + row.picks, 0).toLocaleString()} selections`} />
    </section>

    <section>
      <div className="macro-section-title"><div><span>League leaders</span><h2>Records at a glance</h2></div><p>All records honor the selected week cutoff.</p></div>
      <div className="macro-record-grid">
        {cards.map((card) => <article className="macro-record" key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.detail}</small></article>)}
      </div>
    </section>

    <section>
      <div className="macro-section-title"><div><span>Team play</span><h2>Objective control</h2></div><p>Totals with per-game rates in parentheses.</p></div>
      <TeamMacroTable rows={sortableTeamRows} />
    </section>

    <section>
      <div className="macro-section-title"><div><span>Draft</span><h2>Champion meta</h2></div><p>Pick, ban, presence, results and combat output.</p></div>
      <ChampionMetaTable rows={sortableChampionRows} games={games.length} />
    </section>

    <section>
      <div className="macro-section-title"><div><span>Players</span><h2>Performance leaders</h2></div><p>Season-level rates and champion-pool breadth.</p></div>
      <PlayerLeaderTable rows={sortablePlayerRows} />
    </section>

    <section>
      <div className="macro-section-title"><div><span>Game records</span><h2>Fastest and bloodiest</h2></div><p>Open any game for its full draft and objective breakdown.</p></div>
      <div className="macro-record-tables">
        <RecordTable title="Shortest wins" games={fastestGames} mode="time" />
        <RecordTable title="Most combined kills" games={bloodiestGames} mode="kills" />
      </div>
    </section>
  </div>;
}

function maxBy<T>(rows: T[], score: (row: T) => number) {
  return rows.reduce<T | null>((best, row) => best === null || score(row) > score(best) ? row : best, null);
}

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="macro-kpi"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function RecordTable({
  title,
  games,
  mode,
}: {
  title: string;
  games: Array<{ id: string; winner: string | null; loser: string; team1: string; team2: string; lengthSec: number | null; kills: number }>;
  mode: "time" | "kills";
}) {
  return <div className="card macro-record-table"><h3>{title}</h3><ol>{games.map((game) => <li key={game.id}>
    <span><Link href={`/games/${game.id}`}><b>{game.winner ?? game.team1}</b> vs {game.loser || game.team2}</Link><small>Game {game.id}</small></span>
    <strong>{mode === "time" ? duration(game.lengthSec) : `${game.kills} kills`}</strong>
  </li>)}</ol></div>;
}
