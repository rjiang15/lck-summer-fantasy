export type WeeklyFantasyLine = {
  gameId?: string;
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

type AssignmentSegmentContribution = {
  contribution: RosterWeekContribution;
  creditedGames: number;
};

function teamGameCount(lines: readonly WeeklyFantasyLine[]) {
  const gameIds = new Set(lines.flatMap((line) => line.gameId ? [line.gameId] : []));
  if (gameIds.size > 0) return gameIds.size;
  const timestamps = new Set(lines.flatMap((line) => line.playedAt ? [line.playedAt.getTime()] : []));
  if (timestamps.size > 0) return timestamps.size;
  const linesByPlayer = new Map<string, number>();
  for (const line of lines) {
    linesByPlayer.set(line.playerId, (linesByPlayer.get(line.playerId) ?? 0) + 1);
  }
  return Math.max(0, ...linesByPlayer.values());
}

function resolveAssignmentSegment(
  playerId: string,
  teamId: string,
  role: string,
  roster: readonly TournamentRosterIdentity[],
  lines: readonly WeeklyFantasyLine[],
): AssignmentSegmentContribution {
  const ownLines = lines.filter((line) => line.playerId === playerId && line.teamId === teamId);
  const rawPoints = ownLines.reduce((sum, line) => sum + line.points, 0);
  const pointsPerGame = average(ownLines.map((line) => line.points));
  if (ownLines.length > 0) {
    return {
      creditedGames: ownLines.length,
      contribution: {
        gamesPlayed: ownLines.length,
        rawPoints,
        pointsPerGame,
        creditedPoints: pointsPerGame,
        fallback: null,
      },
    };
  }

  const substituteIds = new Set(roster
    .filter((player) => player.playerId !== playerId && player.teamId === teamId && player.role === role)
    .map((player) => player.playerId));
  const substituteLines = lines.filter((line) =>
    line.teamId === teamId && substituteIds.has(line.playerId),
  );
  const teamLines = lines.filter((line) => line.teamId === teamId);
  if (substituteLines.length === 0 || teamLines.length === 0) {
    return {
      creditedGames: teamGameCount(teamLines),
      contribution: {
        gamesPlayed: 0,
        rawPoints: 0,
        pointsPerGame: 0,
        creditedPoints: 0,
        fallback: null,
      },
    };
  }

  const substitutePointsPerGame = average(substituteLines.map((line) => line.points));
  const teamAveragePointsPerGame = average(teamLines.map((line) => line.points));
  const creditedPoints = Math.min(substitutePointsPerGame, teamAveragePointsPerGame);
  return {
    creditedGames: substituteLines.length,
    contribution: {
      gamesPlayed: 0,
      rawPoints: 0,
      pointsPerGame: 0,
      creditedPoints,
      fallback: {
        reason: "DID_NOT_PLAY",
        teamId,
        role,
        substitutePlayerIds: [...new Set(substituteLines.map((line) => line.playerId))],
        substitutePointsPerGame,
        teamAveragePointsPerGame,
        creditedPoints,
      },
    },
  };
}

export function resolveRosterWeekContribution(
  playerId: string,
  roster: readonly TournamentRosterIdentity[],
  lines: readonly WeeklyFantasyLine[],
  assignmentException: RosterAssignmentException | null = null,
): RosterWeekContribution {
  const ownLines = lines.filter((line) => {
    if (!assignmentException) return line.playerId === playerId;
    const playedAt = line.playedAt?.getTime();
    const beforeEffective = playedAt !== undefined
      && playedAt !== null
      && playedAt < assignmentException.effectiveAt.getTime();
    const effectivePlayerId = beforeEffective
      ? assignmentException.previousPlayerId ?? playerId
      : playerId;
    const effectiveTeamId = beforeEffective
      ? assignmentException.previousTeamId
      : assignmentException.currentTeamId;
    return line.playerId === effectivePlayerId && line.teamId === effectiveTeamId;
  });
  const rawPoints = ownLines.reduce((sum, line) => sum + line.points, 0);
  const pointsPerGame = average(ownLines.map((line) => line.points));
  if (ownLines.length > 0) {
    if (assignmentException) {
      const isBeforeEffective = (line: WeeklyFantasyLine) => {
        const playedAt = line.playedAt?.getTime();
        return playedAt !== undefined
          && playedAt !== null
          && playedAt < assignmentException.effectiveAt.getTime();
      };
      const beforeLines = lines.filter(isBeforeEffective);
      const afterLines = lines.filter((line) => !isBeforeEffective(line));
      const before = resolveAssignmentSegment(
        assignmentException.previousPlayerId ?? playerId,
        assignmentException.previousTeamId,
        assignmentException.role,
        roster,
        beforeLines,
      );
      const after = resolveAssignmentSegment(
        playerId,
        assignmentException.currentTeamId,
        assignmentException.role,
        roster,
        afterLines,
      );
      const creditedGames = before.creditedGames + after.creditedGames;
      const creditedPoints = creditedGames > 0
        ? (
            before.contribution.creditedPoints * before.creditedGames
            + after.contribution.creditedPoints * after.creditedGames
          ) / creditedGames
        : 0;
      const gamesPlayed = before.contribution.gamesPlayed + after.contribution.gamesPlayed;
      const segmentRawPoints = before.contribution.rawPoints + after.contribution.rawPoints;
      return {
        gamesPlayed,
        rawPoints: segmentRawPoints,
        pointsPerGame: gamesPlayed > 0 ? segmentRawPoints / gamesPlayed : 0,
        creditedPoints,
        fallback: after.contribution.fallback ?? before.contribution.fallback,
      };
    }
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
