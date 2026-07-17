// Recompute fields that can be derived from already-ingested scoreboards.
// Safe to run repeatedly; source-specific re-ingestion can later replace the
// reconstructed draft order with authoritative pick/ban order.

import { prisma } from "../lib/db";

const ROLE_ORDER = ["Top", "Jungle", "Mid", "Bot", "Support"];

async function main() {
  const games = await prisma.game.findMany({
    include: { playerStats: true, teamStats: true, draftActions: true },
  });
  let playersUpdated = 0;
  let teamsUpdated = 0;
  let picksCreated = 0;

  for (const game of games) {
    for (const team of game.teamStats) {
      const players = game.playerStats.filter((p) => p.teamId === team.teamId);
      const teamKills = team.kills ?? players.reduce((sum, p) => sum + p.kills, 0);
      const teamDeaths = players.reduce((sum, p) => sum + p.deaths, 0);
      const teamGold = team.gold ?? players.reduce((sum, p) => sum + (p.gold ?? 0), 0);
      const teamDamage = players.reduce((sum, p) => sum + (p.damage ?? 0), 0);
      await prisma.teamGameStat.update({
        where: { id: team.id },
        data: { deaths: team.deaths ?? teamDeaths, gold: team.gold ?? teamGold },
      });
      teamsUpdated++;

      for (const player of players) {
        await prisma.playerGameStat.update({
          where: { id: player.id },
          data: {
            teamKills,
            teamGold,
            killParticipation: teamKills > 0 ? (player.kills + player.assists) / teamKills : null,
            damageShare:
              teamDamage > 0 && player.damage != null ? player.damage / teamDamage : null,
            goldShare: teamGold > 0 && player.gold != null ? player.gold / teamGold : null,
          },
        });
        playersUpdated++;
      }

      const side = team.side;
      const alreadyHasPicks = game.draftActions.some(
        (action) => action.teamId === team.teamId && action.action === "PICK",
      );
      if (!side || alreadyHasPicks) continue;
      const ordered = [...players].sort(
        (a, b) => ROLE_ORDER.indexOf(a.role ?? "") - ROLE_ORDER.indexOf(b.role ?? ""),
      );
      for (const [index, player] of ordered.entries()) {
        await prisma.draftAction.create({
          data: {
            gameId: game.id,
            teamId: team.teamId,
            side,
            action: "PICK",
            sequence: index + 1,
            champion: player.champion,
            role: player.role,
            playerId: player.playerId,
          },
        });
        picksCreated++;
      }
    }
  }

  console.log({ games: games.length, teamsUpdated, playersUpdated, picksCreated });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
