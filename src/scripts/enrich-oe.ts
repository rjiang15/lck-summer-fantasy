// Enrich canonical Leaguepedia games with Oracle's Elixir's wider stat set.
// This deliberately updates existing games instead of creating a duplicate tournament.
// Usage: npm run ingest:oe -- <csv> "Rounds 1-2" [tournament-id] [--week=N]

import fs from "node:fs";
import readline from "node:readline";
import { prisma } from "../lib/db";

type Row = Record<string, string>;
const ROLE_MAP: Record<string, string> = { top: "Top", jng: "Jungle", mid: "Mid", bot: "Bot", sup: "Support" };
const int = (value: string | undefined) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
};
const num = (value: string | undefined) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
};
const bool = (value: string | undefined) => value === "1" ? true : value === "0" ? false : null;
const sideName = (value: string | undefined) => value?.toLowerCase() === "blue" ? "Blue" : value?.toLowerCase() === "red" ? "Red" : null;
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function parseCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') { current += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { result.push(current); current = ""; }
    else current += char;
  }
  result.push(current);
  return result;
}

async function readRows(csvPath: string, split: string) {
  const input = readline.createInterface({ input: fs.createReadStream(csvPath), crlfDelay: Infinity });
  let header: string[] | null = null;
  const rows: Row[] = [];
  for await (const line of input) {
    if (!header) { header = parseCsvLine(line); continue; }
    if (!line.includes("LCK")) continue;
    const values = parseCsvLine(line);
    const row: Row = {};
    header.forEach((name, index) => { row[name] = values[index] ?? ""; });
    if (row.league === "LCK" && row.split === split) rows.push(row);
  }
  return rows;
}

async function enrich(csvPath: string, split: string, requestedTournament: string | null, weekNumber: number | null) {
  const league = await prisma.league.findFirst();
  const tournamentId = requestedTournament ?? league?.tournamentId;
  if (!tournamentId) throw new Error("Pass a canonical tournament id or create a league first");
  const run = await prisma.ingestionRun.create({
    data: { source: "ORACLES_ELIXIR", tournamentId, weekNumber },
  });
  try {
    const rows = await readRows(csvPath, split);
    const byGame = new Map<string, Row[]>();
    for (const row of rows) {
      if (!row.gameid) continue;
      const list = byGame.get(row.gameid) ?? [];
      list.push(row);
      byGame.set(row.gameid, list);
    }
    const canonical = await prisma.game.findMany({
      where: {
        match: {
          tournamentId,
          ...(weekNumber === null ? {} : { week: { number: weekNumber } }),
        },
      },
      include: { match: { include: { week: true } }, playerStats: true, teamStats: true, draftActions: true },
    });
    let mapped = 0;
    let unmapped = 0;
    let consideredGames = 0;
    let playerRows = 0;
    let snapshots = 0;
    const targetDays = new Set(canonical.map((candidate) => (candidate.playedAt ?? candidate.match.scheduledAt).toISOString().slice(0, 10)));
    for (const [oeGameId, gameRows] of byGame) {
      const teams = gameRows.filter((row) => row.position === "team");
      if (teams.length !== 2) continue;
      const date = teams[0].date.slice(0, 10);
      if (weekNumber !== null && !targetDays.has(date)) continue;
      consideredGames++;
      const oeTeams = teams.map((row) => normalize(row.teamname)).sort().join("|");
      const gameNumber = int(teams[0].game) ?? 1;
      const game = canonical.find((candidate) => candidate.riotPlatformGameId === oeGameId) ?? canonical.find((candidate) => {
        const candidateDate = (candidate.playedAt ?? candidate.match.scheduledAt).toISOString().slice(0, 10);
        const candidateTeams = [candidate.match.team1, candidate.match.team2].map(normalize).sort().join("|");
        return candidateDate === date && candidateTeams === oeTeams && candidate.gameNumber === gameNumber;
      });
      if (!game) { unmapped++; continue; }
      mapped++;
      await prisma.game.update({
        where: { id: game.id },
        data: { patch: game.patch ?? (teams[0].patch || null), sourceUrl: game.sourceUrl ?? (teams[0].url || null) },
      });
      for (const teamRow of teams) {
        const side = sideName(teamRow.side);
        const target = game.teamStats.find((row) => row.side === side) ?? game.teamStats.find((row) => normalize(row.teamId) === normalize(teamRow.teamname));
        if (!target) continue;
        const data = {
          kills: int(teamRow.teamkills), deaths: int(teamRow.teamdeaths), gold: int(teamRow.totalgold),
          towers: int(teamRow.towers), turretPlates: int(teamRow.turretplates), dragons: int(teamRow.dragons),
          cloudDrakes: int(teamRow.clouds), infernalDrakes: int(teamRow.infernals), mountainDrakes: int(teamRow.mountains),
          oceanDrakes: int(teamRow.oceans), hextechDrakes: int(teamRow.hextechs), chemtechDrakes: int(teamRow.chemtechs),
          elderDragons: int(teamRow.elders), barons: int(teamRow.barons), heralds: int(teamRow.heralds),
          voidGrubs: int(teamRow.void_grubs), atakhans: int(teamRow.atakhans), inhibs: int(teamRow.inhibitors),
          firstBlood: bool(teamRow.firstblood), firstDragon: bool(teamRow.firstdragon), firstHerald: bool(teamRow.firstherald),
          firstBaron: bool(teamRow.firstbaron), firstTower: bool(teamRow.firsttower), firstMidTower: bool(teamRow.firstmidtower),
          firstThreeTowers: bool(teamRow.firsttothreetowers),
        };
        await prisma.teamGameStat.update({ where: { id: target.id }, data });
        await prisma.statProvenance.upsert({
          where: { gameId_entityType_entityKey_source: { gameId: game.id, entityType: "TEAM_GAME", entityKey: target.teamId, source: "ORACLES_ELIXIR" } },
          create: { gameId: game.id, runId: run.id, entityType: "TEAM_GAME", entityKey: target.teamId, source: "ORACLES_ELIXIR", fields: JSON.stringify(Object.keys(data)) },
          update: { runId: run.id, fields: JSON.stringify(Object.keys(data)), importedAt: new Date() },
        });
        for (const minute of [10, 15, 20, 25]) {
          const values = {
            kills: int(teamRow[`killsat${minute}`]), deaths: int(teamRow[`deathsat${minute}`]), gold: int(teamRow[`goldat${minute}`]),
            xp: int(teamRow[`xpat${minute}`]), cs: int(teamRow[`csat${minute}`]), towers: int(teamRow[`towersat${minute}`]),
            dragons: int(teamRow[`dragonsat${minute}`]), heralds: int(teamRow[`heraldsat${minute}`]),
            voidGrubs: int(teamRow[`void_grubsat${minute}`]), barons: int(teamRow[`baronsat${minute}`]),
          };
          if (Object.values(values).every((value) => value === null)) continue;
          await prisma.teamTimelineSnapshot.upsert({
            where: { gameId_teamId_minute: { gameId: game.id, teamId: target.teamId, minute } },
            create: { gameId: game.id, teamId: target.teamId, minute, ...values, sourceData: JSON.stringify(teamRow) },
            update: { ...values, sourceData: JSON.stringify(teamRow) },
          });
          snapshots++;
        }
      }
      for (const row of gameRows.filter((item) => item.position !== "team")) {
        const role = ROLE_MAP[row.position];
        const side = sideName(row.side);
        const team = game.teamStats.find((item) => item.side === side);
        const target = game.playerStats.find((item) => item.teamId === team?.teamId && item.role === role)
          ?? game.playerStats.find((item) => normalize(item.playerId) === normalize(row.playername));
        if (!target) continue;
        const data = {
          gold: int(row.totalgold), goldEarned: int(row.earnedgold), goldSpent: int(row.goldspent), cs: int(row["total cs"]),
          minionKills: int(row.minionkills), monsterKills: int(row.monsterkills), damage: int(row.damagetochampions),
          damageToObjectives: int(row.damagetoobjectives), damageTaken: int(row.totaldamagetaken), damageMitigated: int(row.damagemitigated),
          totalHeal: int(row.totalheal), visionScore: int(row.visionscore), wardsPlaced: int(row.wardsplaced), wardsKilled: int(row.wardskilled),
          controlWardsBought: int(row.controlwardsbought), doubleKills: int(row.doublekills), tripleKills: int(row.triplekills),
          quadraKills: int(row.quadrakills), pentakills: int(row.pentakills), firstBloodKill: bool(row.firstbloodkill),
          firstBloodAssist: bool(row.firstbloodassist), firstBloodVictim: bool(row.firstbloodvictim), damageShare: num(row.damageshare),
          goldShare: num(row.earnedgoldshare),
        };
        await prisma.playerGameStat.update({ where: { id: target.id }, data });
        playerRows++;
        await prisma.statProvenance.upsert({
          where: { gameId_entityType_entityKey_source: { gameId: game.id, entityType: "PLAYER_GAME", entityKey: target.playerId, source: "ORACLES_ELIXIR" } },
          create: { gameId: game.id, runId: run.id, entityType: "PLAYER_GAME", entityKey: target.playerId, source: "ORACLES_ELIXIR", fields: JSON.stringify(Object.keys(data)) },
          update: { runId: run.id, fields: JSON.stringify(Object.keys(data)), importedAt: new Date() },
        });
        for (const minute of [10, 15, 20, 25]) {
          const values = {
            kills: int(row[`killsat${minute}`]), deaths: int(row[`deathsat${minute}`]), assists: int(row[`assistsat${minute}`]),
            cs: int(row[`csat${minute}`]), gold: int(row[`goldat${minute}`]), xp: int(row[`xpat${minute}`]),
            csDiff: int(row[`csdiffat${minute}`]), goldDiff: int(row[`golddiffat${minute}`]), xpDiff: int(row[`xpdiffat${minute}`]),
          };
          if (Object.values(values).every((value) => value === null)) continue;
          await prisma.playerTimelineSnapshot.upsert({
            where: { gameId_playerId_minute: { gameId: game.id, playerId: target.playerId, minute } },
            create: { gameId: game.id, playerId: target.playerId, minute, ...values, sourceData: JSON.stringify(row) },
            update: { ...values, sourceData: JSON.stringify(row) },
          });
          snapshots++;
        }
      }
    }
    const summary = { sourceRows: rows.length, sourceGames: consideredGames, mappedGames: mapped, unmappedGames: unmapped, playerRows, snapshots };
    await prisma.ingestionRun.update({
      where: { id: run.id }, data: { status: "SUCCEEDED", completedAt: new Date(), rowCount: playerRows, summary: JSON.stringify(summary) },
    });
    console.log(summary);
    if (unmapped > 0) console.warn(`${unmapped} OE games could not be mapped; no duplicate records were created.`);
  } catch (error) {
    await prisma.ingestionRun.update({
      where: { id: run.id }, data: { status: "FAILED", completedAt: new Date(), error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

const csvPath = process.argv[2];
const split = process.argv[3] ?? "Rounds 1-2";
const tournamentArg = process.argv.slice(4).find((arg) => !arg.startsWith("--")) ?? null;
const weekArg = process.argv.find((arg) => arg.startsWith("--week="));
const weekNumber = weekArg ? Number(weekArg.split("=")[1]) : null;
if (!csvPath) {
  console.error('Usage: npm run ingest:oe -- <csv> "<split>" [tournament-id] [--week=N]');
  process.exit(1);
}
enrich(csvPath, split, tournamentArg, weekNumber)
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
