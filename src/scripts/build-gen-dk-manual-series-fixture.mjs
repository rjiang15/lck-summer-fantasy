// Build the deployable reconciliation fixture from the archived source files.
// The generated JSON is imported statically by the commissioner ingest path,
// while the full archives under data/manual remain the audit trail.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const game1Dir = path.join(projectRoot, "data/manual/2026-08-01-gen-vs-dk-game-1");
const game2Dir = path.join(projectRoot, "data/manual/2026-08-01-gen-vs-dk-game-2");
const outputPath = path.join(projectRoot, "src/data/manual-series/2026-08-01-gen-dk.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const [headers, ...values] = rows;
  return values
    .filter((valuesRow) => valuesRow.some(Boolean))
    .map((valuesRow) => Object.fromEntries(headers.map((header, index) => [header, valuesRow[index] ?? ""])));
}

const readCsv = (directory, filename) =>
  parseCsv(fs.readFileSync(path.join(directory, filename), "utf8"));
const integer = (value, fallback = null) => value === "" || value == null ? fallback : Number.parseInt(value, 10);
const number = (value, fallback = null) => value === "" || value == null ? fallback : Number(value);
const ratio = (value, fallback = null) => {
  if (value === "" || value == null) return fallback;
  return value.endsWith("%") ? Number(value.slice(0, -1)) / 100 : Number(value);
};
const boolean = (value) => String(value).toLowerCase() === "true";
const canonicalRole = (value) => ({
  top: "Top", jungle: "Jungle", mid: "Mid", bottom: "Bot", bot: "Bot", adc: "Bot", support: "Support",
})[String(value).toLowerCase()] ?? value;

const g1Players = readCsv(game1Dir, "player-game-stats.csv");
const g1Overrides = new Map(readCsv(game1Dir, "provisional-scoring-overrides.csv").map((row) => [row.player, row]));
const g1Teams = readCsv(game1Dir, "team-game-stats.csv");
const g2Players = readCsv(game2Dir, "player-game-stats.csv");
const g2Teams = readCsv(game2Dir, "team-game-stats.csv");
const g2Drafts = readCsv(game2Dir, "draft-actions.csv");

const g1Drafts = [
  ...["Vi", "Jayce", "Orianna", "Ryze", "Ziggs"].map((champion, index) => ({
    team: "Gen.G", side: "Blue", action: "BAN", sequence: index + 1, champion,
  })),
  ...["Locke", "Shen", "Skarner", "Jhin", "Gnar"].map((champion, index) => ({
    team: "Gen.G", side: "Blue", action: "PICK", sequence: index + 1, champion,
  })),
  ...["Nocturne", "Poppy", "Galio", "Ezreal", "Vayne"].map((champion, index) => ({
    team: "Dplus KIA", side: "Red", action: "BAN", sequence: index + 1, champion,
  })),
  ...["Camille", "Lee Sin", "Cassiopeia", "Olaf", "Corki"].map((champion, index) => ({
    team: "Dplus KIA", side: "Red", action: "PICK", sequence: index + 1, champion,
  })),
];

function g1Player(row) {
  const override = g1Overrides.get(row.player);
  if (!override) throw new Error(`Missing Game 1 override for ${row.player}`);
  return {
    player: row.player,
    team: row.team,
    side: row.side,
    champion: row.champion,
    role: canonicalRole(row.role),
    won: boolean(row.won),
    kills: integer(row.kills),
    deaths: integer(row.deaths),
    assists: integer(row.assists),
    gold: integer(row.total_gold),
    cs: integer(row.cs),
    damage: integer(override.damage_to_champions_override, 0),
    damageToTowers: integer(override.damage_to_towers_override, 0),
    damageMitigated: integer(override.damage_mitigated_override, 0),
    totalHeal: integer(override.total_heal_override, 0),
    visionScore: integer(override.estimated_final_vision_score),
    wardsPlaced: integer(row.wards_placed),
    wardsKilled: integer(row.wards_destroyed),
    controlWardsBought: integer(row.control_wards_bought_observed_min),
    doubleKills: integer(row.double_kill_clusters_observed, 0),
    tripleKills: integer(row.triple_kill_clusters_observed, 0),
    quadraKills: integer(row.quadra_kill_clusters_observed, 0),
    pentakills: integer(row.penta_kill_clusters_observed, 0),
    teamKills: integer(row.team_kills),
    teamGold: integer(row.team_gold),
    killParticipation: number(row.kill_participation_derived),
    damageShare: number(row.champion_damage_share),
    goldShare: number(row.gold_share),
    laneAt15: {
      csDiff: integer(row.cs_diff_at_15),
      goldDiff: integer(row.gold_diff_at_15),
      xpDiff: integer(override.estimated_xp_diff_at_15),
    },
    provisional: {
      fields: ["damage", "damageToTowers", "damageMitigated", "totalHeal", "visionScore", "xpDiff@15"],
      xpConfidence: override.confidence,
      controlWards: row.control_wards_confidence,
    },
  };
}

function g2Player(row) {
  return {
    player: row.player,
    team: row.team,
    side: row.side,
    champion: row.champion,
    role: canonicalRole(row.role),
    won: boolean(row.won),
    kills: integer(row.kills),
    deaths: integer(row.deaths),
    assists: integer(row.assists),
    gold: integer(row.golds),
    cs: integer(row.cs),
    monsterKillsOwnJungle: integer(row["cs in team's jungle"]),
    monsterKillsEnemyJungle: integer(row["cs in enemy jungle"]),
    damage: integer(row["total damage to champion"]),
    damageToTowers: integer(row["damage dealt to turrets"]),
    damageTaken: integer(row["total damage taken"]),
    damageMitigated: integer(row["damage self mitigated"]),
    totalHeal: integer(row["total heal"]),
    visionScore: integer(row["vision score"]),
    wardsPlaced: integer(row["wards placed"]),
    wardsKilled: integer(row["wards destroyed"]),
    controlWardsBought: integer(row["control wards purchased"]),
    doubleKills: integer(row["double kills"], 0),
    tripleKills: integer(row["triple kills"], 0),
    quadraKills: integer(row["quadra kills"], 0),
    pentakills: integer(row["penta kills"], 0),
    teamKills: null,
    teamGold: null,
    killParticipation: ratio(row["kp%"]),
    damageShare: ratio(row["dmg%"]),
    goldShare: ratio(row["gold%"]),
    laneAt15: {
      csDiff: integer(row["csd@15"]),
      goldDiff: integer(row["gd@15"]),
      xpDiff: integer(row["xpd@15"]),
    },
  };
}

function g1Team(row) {
  const gen = row.team === "Gen.G";
  return {
    team: row.team,
    side: row.side,
    won: boolean(row.won),
    kills: integer(row.kills),
    deaths: gen ? 21 : 14,
    gold: integer(row.gold),
    towers: integer(row.towers),
    turretPlates: 0,
    dragons: integer(row.dragons),
    cloudDrakes: 0,
    infernalDrakes: gen ? 1 : 0,
    mountainDrakes: gen ? 0 : 1,
    oceanDrakes: gen ? 0 : 3,
    hextechDrakes: 0,
    chemtechDrakes: 0,
    elderDragons: 0,
    barons: integer(row.barons),
    heralds: integer(row.heralds),
    voidGrubs: integer(row.void_grubs),
    atakhans: integer(row.atakhans, 0),
    inhibs: integer(row.inhibitors),
    firstBlood: !gen,
    firstDragon: gen,
    firstHerald: !gen,
    firstBaron: !gen,
    firstTower: !gen,
  };
}

function g2Team(row) {
  return {
    team: row.team,
    side: row.side,
    won: boolean(row.won),
    kills: integer(row.kills),
    deaths: integer(row.deaths),
    gold: integer(row.gold),
    towers: integer(row.towers),
    turretPlates: integer(row.turret_plates),
    dragons: integer(row.dragons),
    cloudDrakes: integer(row.cloud_drakes),
    infernalDrakes: integer(row.infernal_drakes),
    mountainDrakes: integer(row.mountain_drakes),
    oceanDrakes: integer(row.ocean_drakes),
    hextechDrakes: integer(row.hextech_drakes),
    chemtechDrakes: integer(row.chemtech_drakes),
    elderDragons: integer(row.elder_dragons),
    barons: integer(row.barons),
    heralds: integer(row.heralds),
    voidGrubs: integer(row.void_grubs),
    atakhans: integer(row.atakhans),
    inhibs: integer(row.inhibitors),
    firstBlood: boolean(row.first_blood),
    firstDragon: boolean(row.first_dragon),
    firstHerald: boolean(row.first_herald),
    firstBaron: boolean(row.first_baron),
    firstTower: boolean(row.first_tower),
  };
}

function attachTeamTotals(players, teams) {
  const byName = new Map(teams.map((team) => [team.team, team]));
  return players.map((player) => ({
    ...player,
    teamKills: player.teamKills ?? byName.get(player.team)?.kills ?? null,
    teamGold: player.teamGold ?? byName.get(player.team)?.gold ?? null,
  }));
}

function drafts(rows, players) {
  const pickedPlayer = new Map(players.map((player) => [`${player.team}\0${player.champion}`, player]));
  return rows.map((row) => {
    const action = row.action;
    const picked = action === "PICK" ? pickedPlayer.get(`${row.team}\0${row.champion}`) : null;
    return {
      team: row.team,
      side: row.side,
      action,
      sequence: integer(row.sequence),
      champion: row.champion,
      role: picked?.role ?? null,
      player: picked?.player ?? null,
    };
  });
}

const game1Teams = g1Teams.map(g1Team);
const game1Players = attachTeamTotals(g1Players.map(g1Player), game1Teams);
const game2Teams = g2Teams.map(g2Team);
const game2Players = attachTeamTotals(g2Players.map(g2Player), game2Teams);
const fixture = {
  id: "2026-08-01-gen-dk",
  tournamentId: "LCK/2026 Season/Rounds 3-4",
  date: "2026-08-01",
  teams: ["Gen.G", "Dplus Kia"],
  winner: "Dplus Kia",
  score: [0, 2],
  note: "Game 1 uses Riot live stats plus documented provisional estimates/zeros; Game 2 uses GoL 80676. GoL 80675 is excluded.",
  games: [
    {
      id: "riot:115548147900553474",
      gameNumber: 1,
      winner: "Dplus Kia",
      lengthSec: 1986,
      patch: "16.14.794.9266",
      riotGameId: "115548147900553474",
      sourceUrl: "https://feed.lolesports.com/livestats/v1/window/115548147900553474",
      source: "RIOT_LIVE_STATS_WITH_PROVISIONAL_OVERRIDES",
      players: game1Players,
      teams: game1Teams,
      drafts: drafts(g1Drafts, game1Players),
    },
    {
      id: "gol:80676",
      gameNumber: 2,
      winner: "Dplus Kia",
      lengthSec: 1726,
      patch: "16.14",
      sourceUrl: "https://gol.gg/game/stats/80676/page-game/",
      source: "GAMES_OF_LEGENDS",
      players: game2Players,
      teams: game2Teams,
      drafts: drafts(g2Drafts, game2Players),
    },
  ],
};

for (const game of fixture.games) {
  if (game.players.length !== 10 || game.teams.length !== 2 || game.drafts.length !== 20) {
    throw new Error(`Incomplete fixture for game ${game.gameNumber}`);
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`Wrote ${path.relative(projectRoot, outputPath)}`);
