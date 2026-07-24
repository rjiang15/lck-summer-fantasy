import { loadEnvConfig } from "@next/env";
import { draftFormatForTournament, draftGroupForTeam, isDraftRole } from "../lib/draft";
import { mergeTournamentRosterOverrides, TOURNAMENT_ROSTER_OVERRIDES } from "../lib/tournament-roster-overrides";

loadEnvConfig(process.cwd());

async function main() {
  if (process.argv.includes("--postgres")) {
    const postgresUrl = process.env.POSTGRES_DIRECT_URL?.trim()
      || process.env.POSTGRES_DATABASE_URL?.trim()
      || (process.env.DATABASE_URL?.startsWith("postgres") ? process.env.DATABASE_URL : undefined);
    if (!postgresUrl) throw new Error("Set POSTGRES_DIRECT_URL before synchronizing the production roster");
    process.env.DATABASE_URL = postgresUrl;
  } else {
    process.env.DATABASE_URL = process.env.SQLITE_DATABASE_URL?.trim()
      || (process.env.DATABASE_URL?.startsWith("file:") ? process.env.DATABASE_URL : undefined)
      || "file:./dev.db";
  }
  const { prisma } = await import("../lib/db");
  // draft-pricing imports the shared Prisma client, so it must load only after
  // DATABASE_URL has been pointed at the requested local or PostgreSQL target.
  const { extendDraftPriceSheetWithPeerValues, parseDraftPriceSheet } = await import("../lib/draft-pricing");

  for (const tournamentId of Object.keys(TOURNAMENT_ROSTER_OVERRIDES)) {
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true } });
    if (!tournament) {
      console.log(`Skipped ${tournamentId}: tournament is not stored`);
      continue;
    }
    const players = mergeTournamentRosterOverrides(tournamentId, []);
    for (const player of players) {
      await prisma.proTeam.upsert({ where: { id: player.Team }, create: { id: player.Team }, update: {} });
      await prisma.proPlayer.upsert({
        where: { id: player.Player },
        create: { id: player.Player, name: player.Name, role: player.Role, teamId: player.Team, tournamentId },
        update: { name: player.Name, role: player.Role, teamId: player.Team, tournamentId },
      });
      await prisma.tournamentPlayer.upsert({
        where: { tournamentId_playerId: { tournamentId, playerId: player.Player } },
        create: { tournamentId, playerId: player.Player, teamId: player.Team, role: player.Role },
        update: { teamId: player.Team, role: player.Role, importedAt: new Date() },
      });
      console.log(`Eligible: ${player.Name} — ${player.Team} ${player.Role}`);
    }

    const format = draftFormatForTournament(tournamentId);
    if (format) {
      const peerValues = players.flatMap((player) => {
        const group = draftGroupForTeam(format, player.Team);
        if (!group || !isDraftRole(player.Role)) return [];
        return [{ playerId: player.Player, ppg: null, games: 0, peerGroup: `${group}:${player.Role}` }];
      });
      const leagues = await prisma.league.findMany({
        where: { tournamentId, draftPricingMode: "DYNAMIC", draftPriceSheet: { not: null } },
        select: { id: true, draftPriceSheet: true },
      });
      for (const league of leagues) {
        const sheet = parseDraftPriceSheet(league.draftPriceSheet);
        if (!sheet) continue;
        const extended = extendDraftPriceSheetWithPeerValues(sheet, peerValues);
        if (Object.keys(extended.players).length === Object.keys(sheet.players).length) continue;
        await prisma.league.update({
          where: { id: league.id },
          data: { draftPriceSheet: JSON.stringify(extended) },
        });
        console.log(`Extended frozen dynamic price sheet for league ${league.id}`);
      }
    }
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
