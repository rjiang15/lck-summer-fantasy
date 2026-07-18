// Validation report: top fantasy scorers for an ingested tournament,
// using the default scoring config. Usage:
//   npx tsx src/scripts/report.ts "LCK/2026 Season/Rounds 1-2"

import { prisma } from "../lib/db";
import { DEFAULT_SCORING, playerGamePoints } from "../lib/scoring";

async function report(overviewPage: string) {
  const stats = await prisma.playerGameStat.findMany({
    where: { game: { match: { tournamentId: overviewPage } } },
    include: {
      player: true,
      game: { include: { teamStats: true, playerTimeline: { where: { minute: 15 } } } },
    },
  });
  if (stats.length === 0) {
    console.log("No player stats found — has this tournament been ingested?");
    return;
  }

  const perPlayer = new Map<
    string,
    { name: string; team: string; role: string; games: number; pts: number; k: number; d: number; a: number }
  >();
  for (const s of stats) {
    const pts = playerGamePoints(s, DEFAULT_SCORING, {
      lengthSec: s.game.lengthSec,
      teamObjectives: s.game.teamStats.find((team) => team.teamId === s.teamId),
      laneAt15: s.game.playerTimeline.find((row) => row.playerId === s.playerId),
    });
    const row = perPlayer.get(s.playerId) ?? {
      name: s.player.name,
      team: s.teamId,
      role: s.role ?? "?",
      games: 0,
      pts: 0,
      k: 0,
      d: 0,
      a: 0,
    };
    row.games += 1;
    row.pts += pts;
    row.k += s.kills;
    row.d += s.deaths;
    row.a += s.assists;
    perPlayer.set(s.playerId, row);
  }

  const top = [...perPlayer.values()].sort((a, b) => b.pts / b.games - a.pts / a.games).slice(0, 15);
  const roleSummary = new Map<string, { players: number; games: number; points: number; ppg: number[] }>();
  for (const player of perPlayer.values()) {
    const role = roleSummary.get(player.role) ?? { players: 0, games: 0, points: 0, ppg: [] };
    role.players++;
    role.games += player.games;
    role.points += player.pts;
    role.ppg.push(player.pts / player.games);
    roleSummary.set(player.role, role);
  }
  console.log("\nRole balance (player-season PPG)\n");
  console.log("role       players  game avg  player avg  min    max");
  for (const [role, values] of [...roleSummary].sort(([left], [right]) => left.localeCompare(right))) {
    const mean = values.ppg.reduce((sum, value) => sum + value, 0) / values.ppg.length;
    const gameMean = values.points / values.games;
    console.log(`${role.padEnd(10)} ${String(values.players).padStart(7)}  ${gameMean.toFixed(1).padStart(8)}  ${mean.toFixed(1).padStart(10)}  ${Math.min(...values.ppg).toFixed(1).padStart(5)}  ${Math.max(...values.ppg).toFixed(1).padStart(5)}`);
  }
  console.log(`\nTop 15 fantasy scorers — ${overviewPage} (default scoring)\n`);
  console.log(
    "rank  player            team                    role     games  K/D/A          points/game",
  );
  top.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${r.name.padEnd(16)}  ${r.team.padEnd(22)}  ${r.role.padEnd(7)}  ${String(r.games).padStart(5)}  ${`${r.k}/${r.d}/${r.a}`.padEnd(13)}  ${(r.pts / r.games).toFixed(1)}`,
    );
  });

  // One raw game line for manual spot-checking against lolesports/gol.gg
  const sample = stats[0];
  console.log(
    `\nSpot-check line: ${sample.player.name} (${sample.champion}) in ${sample.gameId}: ` +
      `${sample.kills}/${sample.deaths}/${sample.assists}, ${sample.cs} CS, ` +
      `${sample.gold} gold, ${sample.damage} dmg, ${sample.visionScore} vision`,
  );
}

async function main() {
  let overviewPage = process.argv[2];
  if (!overviewPage) {
    // No arg: use the ingested tournament with the most player stats
    const tournaments = await prisma.tournament.findMany({
      include: { _count: { select: { matches: true } } },
    });
    const withStats: { id: string; stats: number }[] = [];
    for (const t of tournaments) {
      const stats = await prisma.playerGameStat.count({
        where: { game: { match: { tournamentId: t.id } } },
      });
      if (stats > 0) withStats.push({ id: t.id, stats });
    }
    if (withStats.length === 0) {
      console.log("No ingested data found. Run an ingest script first.");
      return;
    }
    withStats.sort((a, b) => b.stats - a.stats);
    overviewPage = withStats[0].id;
    console.log(`(no tournament given — using "${overviewPage}")`);
    if (withStats.length > 1) {
      console.log(`(also available: ${withStats.slice(1).map((t) => `"${t.id}"`).join(", ")})`);
    }
  }
  await report(overviewPage);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
