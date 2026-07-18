// Deep statistical explorer: player performance, champion meta, and team macro.
import { prisma } from "@/lib/db";
import { getDataViewState } from "@/lib/view";
import { ChampionLabel, TeamLabel } from "@/components/GameIdentity";
import { parseScoring, round1 } from "@/lib/fantasy";
import { playerGameScore } from "@/lib/scoring";
import DeepPlayerTable, { type DeepPlayerRow } from "./DeepPlayerTable";

export const dynamic = "force-dynamic";

const pct = (part: number, total: number) =>
  total === 0 ? "—" : `${((part / total) * 100).toFixed(1)}%`;

const perGame = (value: number, games: number) =>
  games === 0 ? "—" : (value / games).toFixed(1);

const OPTIONAL_PLAYER_METRICS = [
  "gold", "goldEarned", "goldSpent", "minionKills", "monsterKills",
  "monsterKillsOwnJungle", "monsterKillsEnemyJungle", "damage", "damageToObjectives",
  "damageToTowers", "damageTaken", "damageMitigated", "totalHeal", "visionScore",
  "wardsPlaced", "wardsKilled", "controlWardsBought", "doubleKills", "tripleKills",
  "quadraKills", "pentakills", "teamKills", "teamGold", "killParticipation",
  "damageShare", "goldShare",
] as const;

type PlayerAggregate = {
  id: string;
  name: string;
  team: string;
  role: string;
  games: number;
  wins: number;
  fantasyPoints: number;
  combatPoints: number;
  farmPoints: number;
  visionPoints: number;
  winPoints: number;
  killParticipationPoints: number;
  efficiencyPoints: number;
  jungleObjectivePoints: number;
  laneImpactPoints: number;
  towerPressurePoints: number;
  durabilityPoints: number;
  multikillPoints: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  maxKills: number;
  maxCs: number;
  champions: Map<string, number>;
  sums: Record<string, number>;
  samples: Record<string, number>;
};

const addMetric = (row: PlayerAggregate, key: string, value: number | null | undefined) => {
  if (value == null) return;
  row.sums[key] = (row.sums[key] ?? 0) + value;
  row.samples[key] = (row.samples[key] ?? 0) + 1;
};

const averageMetric = (row: PlayerAggregate, key: string) => row.samples[key] ? row.sums[key] / row.samples[key] : null;
const totalMetric = (row: PlayerAggregate, key: string) => row.samples[key] ? row.sums[key] : null;

export default async function StatsPage() {
  const view = await getDataViewState();
  if (!view) return <p>No data ingested yet.</p>;
  const [games, league] = await Promise.all([
    prisma.game.findMany({
      where: {
        match: {
          tournamentId: view.tournamentId,
          ...(view.cutoff ? { scheduledAt: { lt: view.cutoff } } : {}),
        },
      },
      include: {
        playerStats: { include: { player: true } },
        playerTimeline: { where: { minute: 15 } },
        teamStats: true,
        draftActions: true,
      },
    }),
    prisma.league.findUnique({ where: { id: view.leagueId }, select: { scoringConfig: true } }),
  ]);
  const scoring = parseScoring(league?.scoringConfig);

  const players = new Map<string, PlayerAggregate>();
  const champions = new Map<string, { picks: number; wins: number; bans: number }>();
  const teams = new Map<string, {
    games: number; wins: number; kills: number; towers: number; dragons: number;
    barons: number; heralds: number; voidGrubs: number; atakhans: number;
    firstBloods: number; firstDragons: number; firstBarons: number; firstTowers: number;
  }>();

  for (const game of games) {
    for (const stat of game.playerStats) {
      const row = players.get(stat.playerId) ?? {
        id: stat.playerId,
        name: stat.player.name,
        team: stat.teamId,
        role: stat.role ?? stat.player.role ?? "?",
        games: 0,
        wins: 0,
        fantasyPoints: 0,
        combatPoints: 0,
        farmPoints: 0,
        visionPoints: 0,
        winPoints: 0,
        killParticipationPoints: 0,
        efficiencyPoints: 0,
        jungleObjectivePoints: 0,
        laneImpactPoints: 0,
        towerPressurePoints: 0,
        durabilityPoints: 0,
        multikillPoints: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        maxKills: 0,
        maxCs: 0,
        champions: new Map<string, number>(),
        sums: {},
        samples: {},
      };
      row.games++;
      row.wins += stat.won ? 1 : 0;
      const score = playerGameScore(stat, scoring, {
        lengthSec: game.lengthSec,
        teamObjectives: game.teamStats.find((team) => team.teamId === stat.teamId),
        laneAt15: game.playerTimeline.find((row) => row.playerId === stat.playerId),
      });
      row.fantasyPoints += score.total;
      row.combatPoints += score.combat;
      row.farmPoints += score.farm;
      row.visionPoints += score.vision;
      row.winPoints += score.win;
      row.killParticipationPoints += score.killParticipation;
      row.efficiencyPoints += score.efficiency;
      row.jungleObjectivePoints += score.jungleObjectives;
      row.laneImpactPoints += score.laneImpact;
      row.towerPressurePoints += score.towerPressure;
      row.durabilityPoints += score.durability;
      row.multikillPoints += score.multikill;
      row.kills += stat.kills;
      row.deaths += stat.deaths;
      row.assists += stat.assists;
      row.cs += stat.cs ?? 0;
      row.maxKills = Math.max(row.maxKills, stat.kills);
      row.maxCs = Math.max(row.maxCs, stat.cs ?? 0);
      row.champions.set(stat.champion, (row.champions.get(stat.champion) ?? 0) + 1);
      for (const metric of OPTIONAL_PLAYER_METRICS) addMetric(row, metric, stat[metric]);
      if (stat.firstBloodKill != null) addMetric(row, "firstBloodKills", stat.firstBloodKill ? 1 : 0);
      if (stat.firstBloodAssist != null) addMetric(row, "firstBloodAssists", stat.firstBloodAssist ? 1 : 0);
      if (stat.firstBloodVictim != null) addMetric(row, "firstBloodVictims", stat.firstBloodVictim ? 1 : 0);
      row.team = stat.teamId;
      row.role = stat.role ?? stat.player.role ?? row.role;
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
    for (const timeline of game.playerTimeline) {
      const row = players.get(timeline.playerId);
      if (!row) continue;
      addMetric(row, "csDiff15", timeline.csDiff);
      addMetric(row, "goldDiff15", timeline.goldDiff);
      addMetric(row, "xpDiff15", timeline.xpDiff);
    }
  }

  const playerRows: DeepPlayerRow[] = [...players.values()].map((row) => {
    const mostPlayedChampion = [...row.champions.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "Unknown";
    const fantasyPoints = round1(row.fantasyPoints);
    return {
      id: row.id,
      name: row.name,
      team: row.team,
      role: row.role,
      fantasyPoints,
      fantasyPerGame: fantasyPoints / row.games,
      combatPointsPerGame: row.combatPoints / row.games,
      farmPointsPerGame: row.farmPoints / row.games,
      visionPointsPerGame: row.visionPoints / row.games,
      winPointsPerGame: row.winPoints / row.games,
      killParticipationPointsPerGame: row.killParticipationPoints / row.games,
      efficiencyPointsPerGame: row.efficiencyPoints / row.games,
      jungleObjectivePointsPerGame: row.jungleObjectivePoints / row.games,
      laneImpactPointsPerGame: row.laneImpactPoints / row.games,
      towerPressurePointsPerGame: row.towerPressurePoints / row.games,
      durabilityPointsPerGame: row.durabilityPoints / row.games,
      multikillPointsPerGame: row.multikillPoints / row.games,
      games: row.games,
      wins: row.wins,
      winRate: row.wins / row.games,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      kda: (row.kills + row.assists) / Math.max(1, row.deaths),
      killsPerGame: row.kills / row.games,
      deathsPerGame: row.deaths / row.games,
      assistsPerGame: row.assists / row.games,
      killParticipation: averageMetric(row, "killParticipation"),
      maxKills: row.maxKills,
      damagePerGame: averageMetric(row, "damage"),
      damageShare: averageMetric(row, "damageShare"),
      objectiveDamagePerGame: averageMetric(row, "damageToObjectives"),
      towerDamagePerGame: averageMetric(row, "damageToTowers"),
      damageTakenPerGame: averageMetric(row, "damageTaken"),
      damageMitigatedPerGame: averageMetric(row, "damageMitigated"),
      healingPerGame: averageMetric(row, "totalHeal"),
      cs: row.cs,
      csPerGame: row.cs / row.games,
      maxCs: row.maxCs,
      minionsPerGame: averageMetric(row, "minionKills"),
      monstersPerGame: averageMetric(row, "monsterKills"),
      ownJungleMonstersPerGame: averageMetric(row, "monsterKillsOwnJungle"),
      enemyJungleMonstersPerGame: averageMetric(row, "monsterKillsEnemyJungle"),
      goldPerGame: averageMetric(row, "gold"),
      goldEarnedPerGame: averageMetric(row, "goldEarned"),
      goldSpentPerGame: averageMetric(row, "goldSpent"),
      goldShare: averageMetric(row, "goldShare"),
      teamKillsPerGame: averageMetric(row, "teamKills"),
      teamGoldPerGame: averageMetric(row, "teamGold"),
      visionPerGame: averageMetric(row, "visionScore"),
      wardsPlacedPerGame: averageMetric(row, "wardsPlaced"),
      wardsKilledPerGame: averageMetric(row, "wardsKilled"),
      controlWardsPerGame: averageMetric(row, "controlWardsBought"),
      championPool: row.champions.size,
      mostPlayedChampion,
      doubleKills: totalMetric(row, "doubleKills"),
      tripleKills: totalMetric(row, "tripleKills"),
      quadraKills: totalMetric(row, "quadraKills"),
      pentakills: totalMetric(row, "pentakills"),
      firstBloodKills: totalMetric(row, "firstBloodKills"),
      firstBloodAssists: totalMetric(row, "firstBloodAssists"),
      firstBloodVictims: totalMetric(row, "firstBloodVictims"),
      csDiff15: averageMetric(row, "csDiff15"),
      goldDiff15: averageMetric(row, "goldDiff15"),
      xpDiff15: averageMetric(row, "xpDiff15"),
    };
  });
  const championRows = [...champions.entries()].sort(
    (a, b) => b[1].picks + b[1].bans - (a[1].picks + a[1].bans),
  );
  const teamRows = [...teams.entries()].sort((a, b) => b[1].wins - a[1].wins);

  return <>
    <h1>Deep stats</h1>
    <p className="muted small">
      {view.tournamentName} · {games.length} games. Blank advanced fields mean the selected source did not publish that metric; raw source rows are retained for future parsers.
    </p>

    <div className="card">
      <b>Fantasy scoring v{scoring.version}</b>
      <p className="small muted" style={{ marginBottom: 0 }}>
        Pts/G is the official player value: total game scores divided by games played. Standard KP awards {scoring.player.kpLowBonus}/{scoring.player.kpMidBonus}/{scoring.player.kpHighBonus} points at {scoring.player.kpLowThreshold * 100}%/{scoring.player.kpMidThreshold * 100}%/{scoring.player.kpHighThreshold * 100}%; Top uses role-calibrated {scoring.player.topKpLowThreshold * 100}%/{scoring.player.topKpMidThreshold * 100}%/{scoring.player.topKpHighThreshold * 100}% tiers. Carry efficiency compares damage share with gold share; support efficiency rewards normalized vision denial. The formula also scores a combined CSD/GD/XPD lane-impact result, role-relative tower pressure and damage mitigation, multikills, and Jungle team objectives. All rate stats normalize to a 30-minute game.
      </p>
    </div>

    <div className="macro-section-title deep-stats-title"><div><span>Players</span><h2>Complete player detail</h2></div><p>Fantasy scoring uses {view.leagueName}&apos;s active rules. Click any column to sort.</p></div>
    <DeepPlayerTable rows={playerRows} />

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
