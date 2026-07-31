export type WeeklyFantasyLine = {
  playerId: string;
  teamId: string;
  points: number;
  playedAt?: Date | null;
};

export type TournamentRosterIdentity = {
  playerId: string;
  teamId: string | null;
  role: string | null;
};

export type RosterWeekContribution = {
  gamesPlayed: number;
  rawPoints: number;
  pointsPerGame: number;
  creditedPoints: number;
  fallback: null | {
    reason: "DID_NOT_PLAY";
    teamId: string;
    role: string;
    substitutePlayerIds: string[];
    substitutePointsPerGame: number;
    teamAveragePointsPerGame: number;
    creditedPoints: number;
  };
};

export type RosterAssignmentException = {
  id: string;
  effectiveAt: Date;
  previousPlayerId?: string;
  previousTeamId: string;
  currentTeamId: string;
  role: string;
};

const average = (values: readonly number[]) => values.length > 0
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;

export function resolveRosterWeekContribution(
  playerId: string,
  roster: readonly TournamentRosterIdentity[],
  lines: readonly WeeklyFantasyLine[],
  assignmentException: RosterAssignmentException | null = null,
): RosterWeekContribution {
  const ownLines = lines.filter((line) => {
    if (!assignmentException?.previousPlayerId) return line.playerId === playerId;
    const playedAt = line.playedAt?.getTime();
    const effectivePlayerId = playedAt !== undefined
      && playedAt !== null
      && playedAt < assignmentException.effectiveAt.getTime()
      ? assignmentException.previousPlayerId
      : playerId;
    return line.playerId === effectivePlayerId;
  });
  const rawPoints = ownLines.reduce((sum, line) => sum + line.points, 0);
  const pointsPerGame = average(ownLines.map((line) => line.points));
  if (ownLines.length > 0) {
    return { gamesPlayed: ownLines.length, rawPoints, pointsPerGame, creditedPoints: pointsPerGame, fallback: null };
  }

  const identity = roster.find((player) => player.playerId === playerId);
  const currentTeamId = assignmentException?.currentTeamId ?? identity?.teamId;
  const role = assignmentException?.role ?? identity?.role;
  if (!currentTeamId || !role) {
    return { gamesPlayed: 0, rawPoints: 0, pointsPerGame: 0, creditedPoints: 0, fallback: null };
  }
  const targetTeamForLine = (line: WeeklyFantasyLine) => {
    if (!assignmentException) return currentTeamId;
    const playedAt = line.playedAt?.getTime();
    return playedAt !== undefined
      && playedAt !== null
      && playedAt < assignmentException.effectiveAt.getTime()
      ? assignmentException.previousTeamId
      : assignmentException.currentTeamId;
  };
  const eligibleTeams = assignmentException
    ? [assignmentException.previousTeamId, assignmentException.currentTeamId]
    : [currentTeamId];
  const substituteIdsByTeam = new Map(eligibleTeams.map((teamId) => [
    teamId,
    new Set(roster
      .filter((player) => {
        const assignedPlayerId = assignmentException?.previousPlayerId
          && teamId === assignmentException.previousTeamId
          ? assignmentException.previousPlayerId
          : playerId;
        return player.playerId !== assignedPlayerId
          && player.teamId === teamId
          && player.role === role;
      })
      .map((player) => player.playerId)),
  ]));
  const substituteLines = lines.filter((line) => {
    const targetTeam = targetTeamForLine(line);
    return line.teamId === targetTeam && Boolean(substituteIdsByTeam.get(targetTeam)?.has(line.playerId));
  });
  const teamLines = lines.filter((line) => line.teamId === targetTeamForLine(line));
  if (substituteLines.length === 0 || teamLines.length === 0) {
    return { gamesPlayed: 0, rawPoints: 0, pointsPerGame: 0, creditedPoints: 0, fallback: null };
  }

  const substitutePointsPerGame = average(substituteLines.map((line) => line.points));
  const teamAveragePointsPerGame = average(teamLines.map((line) => line.points));
  const creditedPoints = Math.min(substitutePointsPerGame, teamAveragePointsPerGame);
  return {
    gamesPlayed: 0,
    rawPoints: 0,
    pointsPerGame: 0,
    creditedPoints,
    fallback: {
      reason: "DID_NOT_PLAY",
      teamId: currentTeamId,
      role,
      substitutePlayerIds: [...new Set(substituteLines.map((line) => line.playerId))],
      substitutePointsPerGame,
      teamAveragePointsPerGame,
      creditedPoints,
    },
  };
}
