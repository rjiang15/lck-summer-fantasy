// Import a Riot-style match timeline at event/frame granularity.
//
// Usage:
//   npx tsx src/scripts/ingest-timeline.ts <game-id> <timeline.json>
//
// The JSON can be a raw Match-V5 timeline plus a top-level `participants`
// mapping, or an envelope shaped like:
// {
//   "timeline": { "info": { "frames": [...] } },
//   "participants": [
//     { "participantId": 1, "playerId": "Zeus", "teamId": "T1" }
//   ]
// }
// Raw events are preserved in GameEvent.payload, so new Riot event fields are
// retained even before the relational schema learns about them.

import fs from "node:fs";
import { prisma } from "../lib/db";

interface ParticipantMapping {
  participantId: number;
  playerId: string;
  teamId: string;
  /** Riot numeric team id, normally 100 or 200; needed for team-only events. */
  riotTeamId?: number;
}

interface TimelineEnvelope {
  timeline?: { info?: { frames?: TimelineFrame[] } };
  info?: { frames?: TimelineFrame[] };
  participants?: ParticipantMapping[];
}

interface TimelineFrame {
  timestamp?: number;
  participantFrames?: Record<
    string,
    {
      participantId?: number;
      totalGold?: number;
      currentGold?: number;
      xp?: number;
      level?: number;
      minionsKilled?: number;
      jungleMinionsKilled?: number;
    }
  >;
  events?: Record<string, unknown>[];
}

const numberValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const stringValue = (value: unknown) => (typeof value === "string" ? value : null);

async function ingestTimeline(gameId: string, path: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { playerStats: true },
  });
  if (!game) throw new Error(`Unknown game: ${gameId}`);

  const document = JSON.parse(fs.readFileSync(path, "utf8")) as TimelineEnvelope;
  const frames = document.timeline?.info?.frames ?? document.info?.frames ?? [];
  const mappings = document.participants ?? [];
  if (frames.length === 0) throw new Error("Timeline has no info.frames array.");
  if (mappings.length === 0) {
    throw new Error(
      "Timeline requires a participants mapping from Riot participantId to database playerId/teamId.",
    );
  }

  const mappingByParticipant = new Map(mappings.map((p) => [p.participantId, p]));
  const missingPlayers = mappings.filter(
    (p) => !game.playerStats.some((s) => s.playerId === p.playerId && s.teamId === p.teamId),
  );
  if (missingPlayers.length > 0) {
    throw new Error(
      `Mappings do not match this game's scoreboard: ${missingPlayers.map((p) => p.playerId).join(", ")}`,
    );
  }

  const cumulative = new Map<number, { kills: number; deaths: number; assists: number }>();
  for (const p of mappings) cumulative.set(p.participantId, { kills: 0, deaths: 0, assists: 0 });

  let eventCount = 0;
  let snapshotCount = 0;
  for (const [frameIndex, frame] of frames.entries()) {
    const timestampMs = frame.timestamp ?? frameIndex * 60_000;
    for (const [eventIndex, event] of (frame.events ?? []).entries()) {
      const type = stringValue(event.type) ?? "UNKNOWN";
      const killerId = numberValue(event.killerId);
      const victimId = numberValue(event.victimId);
      const assists = Array.isArray(event.assistingParticipantIds)
        ? event.assistingParticipantIds.filter((v): v is number => typeof v === "number")
        : [];
      if (type === "CHAMPION_KILL") {
        if (killerId && cumulative.has(killerId)) cumulative.get(killerId)!.kills++;
        if (victimId && cumulative.has(victimId)) cumulative.get(victimId)!.deaths++;
        for (const id of assists) if (cumulative.has(id)) cumulative.get(id)!.assists++;
      }

      const killer = killerId ? mappingByParticipant.get(killerId) : null;
      const victim = victimId ? mappingByParticipant.get(victimId) : null;
      const teamId =
        killer?.teamId ??
        mappings.find((p) => p.riotTeamId === numberValue(event.killerTeamId))?.teamId ??
        null;
      const position =
        event.position && typeof event.position === "object"
          ? (event.position as Record<string, unknown>)
          : null;
      const sourceKey = `${timestampMs}:${frameIndex}:${eventIndex}:${type}`;
      await prisma.gameEvent.upsert({
        where: { gameId_sourceKey: { gameId, sourceKey } },
        create: {
          gameId,
          sourceKey,
          timestampMs: numberValue(event.timestamp) ?? timestampMs,
          type,
          teamId,
          playerId: killer?.playerId ?? null,
          victimPlayerId: victim?.playerId ?? null,
          assistingPlayerIds: JSON.stringify(
            assists.map((id) => mappingByParticipant.get(id)?.playerId).filter(Boolean),
          ),
          champion: stringValue(event.championName),
          monsterType: stringValue(event.monsterType),
          monsterSubType: stringValue(event.monsterSubType),
          buildingType: stringValue(event.buildingType),
          laneType: stringValue(event.laneType),
          positionX: numberValue(position?.x),
          positionY: numberValue(position?.y),
          payload: JSON.stringify(event),
        },
        update: { payload: JSON.stringify(event) },
      });
      eventCount++;
    }

    const minute = Math.round(timestampMs / 60_000);
    const teamFrames = new Map<
      string,
      { gold: number; xp: number; cs: number; kills: number; deaths: number }
    >();
    const frameValues = new Map<number, { gold: number | null; xp: number | null; cs: number }>();
    for (const participantFrame of Object.values(frame.participantFrames ?? {})) {
      if (!participantFrame.participantId) continue;
      frameValues.set(participantFrame.participantId, {
        gold: participantFrame.totalGold ?? null,
        xp: participantFrame.xp ?? null,
        cs: (participantFrame.minionsKilled ?? 0) + (participantFrame.jungleMinionsKilled ?? 0),
      });
    }
    for (const participantFrame of Object.values(frame.participantFrames ?? {})) {
      const participantId = participantFrame.participantId;
      if (!participantId) continue;
      const mapping = mappingByParticipant.get(participantId);
      if (!mapping) continue;
      const score = cumulative.get(participantId) ?? { kills: 0, deaths: 0, assists: 0 };
      const cs =
        (participantFrame.minionsKilled ?? 0) + (participantFrame.jungleMinionsKilled ?? 0);
      const gameStat = game.playerStats.find((stat) => stat.playerId === mapping.playerId);
      const opponentStat = game.playerStats.find(
        (stat) => stat.teamId !== mapping.teamId && stat.role === gameStat?.role,
      );
      const opponentMapping = mappings.find((p) => p.playerId === opponentStat?.playerId);
      const opponent = opponentMapping ? frameValues.get(opponentMapping.participantId) : null;
      const csDiff = opponent ? cs - opponent.cs : null;
      const goldDiff =
        participantFrame.totalGold != null && opponent?.gold != null
          ? participantFrame.totalGold - opponent.gold
          : null;
      const xpDiff =
        participantFrame.xp != null && opponent?.xp != null
          ? participantFrame.xp - opponent.xp
          : null;
      await prisma.playerTimelineSnapshot.upsert({
        where: { gameId_playerId_minute: { gameId, playerId: mapping.playerId, minute } },
        create: {
          gameId,
          playerId: mapping.playerId,
          minute,
          kills: score.kills,
          deaths: score.deaths,
          assists: score.assists,
          cs,
          gold: participantFrame.totalGold ?? null,
          xp: participantFrame.xp ?? null,
          level: participantFrame.level ?? null,
          csDiff,
          goldDiff,
          xpDiff,
          sourceData: JSON.stringify(participantFrame),
        },
        update: {
          kills: score.kills,
          deaths: score.deaths,
          assists: score.assists,
          cs,
          gold: participantFrame.totalGold ?? null,
          xp: participantFrame.xp ?? null,
          level: participantFrame.level ?? null,
          csDiff,
          goldDiff,
          xpDiff,
          sourceData: JSON.stringify(participantFrame),
        },
      });
      const team = teamFrames.get(mapping.teamId) ?? { gold: 0, xp: 0, cs: 0, kills: 0, deaths: 0 };
      team.gold += participantFrame.totalGold ?? 0;
      team.xp += participantFrame.xp ?? 0;
      team.cs += cs;
      team.kills += score.kills;
      team.deaths += score.deaths;
      teamFrames.set(mapping.teamId, team);
      snapshotCount++;
    }
    for (const [teamId, values] of teamFrames) {
      await prisma.teamTimelineSnapshot.upsert({
        where: { gameId_teamId_minute: { gameId, teamId, minute } },
        create: { gameId, teamId, minute, ...values },
        update: values,
      });
    }
  }

  console.log(`Imported ${eventCount} events and ${snapshotCount} player snapshots for ${gameId}.`);
}

const [gameId, timelinePath] = [process.argv[2], process.argv[3]];
if (!gameId || !timelinePath) {
  console.error("Usage: npx tsx src/scripts/ingest-timeline.ts <game-id> <timeline.json>");
  process.exit(1);
}

ingestTimeline(gameId, timelinePath)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
