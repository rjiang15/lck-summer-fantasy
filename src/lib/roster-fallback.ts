export type WeeklyFantasyLine = {
  playerId: string;
  teamId: string;
  points: number;
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

const average = (values: readonly number[]) => values.length > 0
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;

export function resolveRosterWeekContribution(
  playerId: string,
  roster: readonly TournamentRosterIdentity[],
  lines: readonly WeeklyFantasyLine[],
): RosterWeekContribution {
  const ownLines = lines.filter((line) => line.playerId === playerId);
  const rawPoints = ownLines.reduce((sum, line) => sum + line.points, 0);
  const pointsPerGame = average(ownLines.map((line) => line.points));
  if (ownLines.length > 0) {
    return { gamesPlayed: ownLines.length, rawPoints, pointsPerGame, creditedPoints: pointsPerGame, fallback: null };
  }

  const identity = roster.find((player) => player.playerId === playerId);
  if (!identity?.teamId || !identity.role) {
    return { gamesPlayed: 0, rawPoints: 0, pointsPerGame: 0, creditedPoints: 0, fallback: null };
  }
  const substituteIds = new Set(roster
    .filter((player) => player.playerId !== playerId && player.teamId === identity.teamId && player.role === identity.role)
    .map((player) => player.playerId));
  const substituteLines = lines.filter((line) => substituteIds.has(line.playerId) && line.teamId === identity.teamId);
  const teamLines = lines.filter((line) => line.teamId === identity.teamId);
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
      teamId: identity.teamId,
      role: identity.role,
      substitutePlayerIds: [...new Set(substituteLines.map((line) => line.playerId))],
      substitutePointsPerGame,
      teamAveragePointsPerGame,
      creditedPoints,
    },
  };
}
