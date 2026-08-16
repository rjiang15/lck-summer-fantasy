import { playerNameplateKey, type RosterWeekContribution } from "./roster-fallback";

export type RosterAuditSlot = {
  id: number;
  playerId: string;
  playerName: string;
  slot: string;
  teamId: string | null;
  role: string | null;
  creditedPoints: number;
  fallback: RosterWeekContribution["fallback"];
  assignmentException: null | {
    effectiveAt: Date;
    previousPlayerId?: string;
    previousTeamId: string;
    currentTeamId: string;
    role: string;
  };
};

export type RosterAuditMatch = {
  id: string;
  team1: string;
  team2: string;
  scheduledAt: Date;
  games: Array<{
    id: string;
    gameNumber: number;
    playedAt: Date;
    lines: Array<{
      playerId: string;
      playerName: string;
      teamId: string;
      role: string | null;
      points: number;
    }>;
  }>;
};

export type RosterGameAudit = {
  slotId: number;
  series: Array<{
    matchId: string;
    teamId: string;
    opponent: string;
    scheduledAt: Date;
    games: Array<{
      gameId: string;
      gameNumber: number;
      points: number | null;
      actualPlayerId: string | null;
      actualPlayerName: string | null;
      status: "OWN" | "SUBSTITUTE_CREDIT" | "OTHER_PLAYER" | "NO_DATA";
      teamAveragePoints: number | null;
      fallbackCredit: number | null;
    }>;
  }>;
};

const roleKey = (value: string | null) => value?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
const samePlayer = (left: string, right: string) => playerNameplateKey(left) === playerNameplateKey(right);

function assignmentAt(slot: RosterAuditSlot, at: Date) {
  const exception = slot.assignmentException;
  if (exception && at < exception.effectiveAt) {
    return {
      playerId: exception.previousPlayerId ?? slot.playerId,
      teamId: exception.previousTeamId,
      role: exception.role,
    };
  }
  return {
    playerId: slot.playerId,
    teamId: exception?.currentTeamId ?? slot.teamId,
    role: exception?.role ?? slot.role,
  };
}

export function buildRosterGameAudits(
  slots: readonly RosterAuditSlot[],
  matches: readonly RosterAuditMatch[],
): RosterGameAudit[] {
  return slots.map((slot) => ({
    slotId: slot.id,
    series: matches.flatMap((match) => {
      const scheduledAssignment = assignmentAt(slot, match.scheduledAt);
      if (!scheduledAssignment.teamId || ![match.team1, match.team2].includes(scheduledAssignment.teamId)) return [];
      const opponent = match.team1 === scheduledAssignment.teamId ? match.team2 : match.team1;
      return [{
        matchId: match.id,
        teamId: scheduledAssignment.teamId,
        opponent,
        scheduledAt: match.scheduledAt,
        games: match.games.map((game) => {
          const assignment = assignmentAt(slot, game.playedAt);
          const roleLines = assignment.teamId && assignment.role
            ? game.lines.filter((line) =>
                line.teamId === assignment.teamId && roleKey(line.role) === roleKey(assignment.role),
              )
            : [];
          const ownLine = roleLines.find((line) => samePlayer(line.playerId, assignment.playerId));
          const actual = ownLine ?? roleLines[0] ?? null;
          if (!actual) {
            return {
              gameId: game.id,
              gameNumber: game.gameNumber,
              points: null,
              actualPlayerId: null,
              actualPlayerName: null,
              status: "NO_DATA" as const,
              teamAveragePoints: null,
              fallbackCredit: null,
            };
          }
          if (ownLine) {
            return {
              gameId: game.id,
              gameNumber: game.gameNumber,
              points: actual.points,
              actualPlayerId: actual.playerId,
              actualPlayerName: actual.playerName,
              status: "OWN" as const,
              teamAveragePoints: null,
              fallbackCredit: null,
            };
          }
          const fallbackApplied = slot.slot !== "BENCH"
            && Boolean(slot.fallback?.substitutePlayerIds.some((id) => samePlayer(id, actual.playerId)));
          const teamLines = assignment.teamId
            ? game.lines.filter((line) => line.teamId === assignment.teamId)
            : [];
          const teamAveragePoints = teamLines.length > 0
            ? teamLines.reduce((sum, line) => sum + line.points, 0) / teamLines.length
            : null;
          return {
            gameId: game.id,
            gameNumber: game.gameNumber,
            points: actual.points,
            actualPlayerId: actual.playerId,
            actualPlayerName: actual.playerName,
            status: fallbackApplied ? "SUBSTITUTE_CREDIT" as const : "OTHER_PLAYER" as const,
            teamAveragePoints: fallbackApplied ? teamAveragePoints : null,
            fallbackCredit: fallbackApplied && teamAveragePoints !== null
              ? Math.min(actual.points, teamAveragePoints)
              : null,
          };
        }),
      }];
    }),
  }));
}
