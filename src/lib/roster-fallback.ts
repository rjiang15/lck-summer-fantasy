export type WeeklyFantasyLine = {
  gameId?: string;
  playerId: string;
  teamId: string;
  role?: string | null;
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

/**
 * Leaguepedia and Gol.gg can identify the same nameplate with different casing
 * or with a disambiguating real-name suffix (for example `Deokdam`/`deokdam`
 * and `Peter`/`Peter (Jeong Yoon-su)`). Fantasy ownership follows the
 * nameplate, so those source variants must not trigger substitute scoring.
 */
export function playerNameplateKey(value: string) {
  return value
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const samePlayerNameplate = (left: string, right: string) =>
  playerNameplateKey(left) === playerNameplateKey(right);

const roleKey = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");
const lineMatchesRole = (line: WeeklyFantasyLine, role: string) =>
  !line.role || roleKey(line.role) === roleKey(role);

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

function lineGameKey(line: WeeklyFantasyLine) {
  if (line.gameId) return `game:${line.gameId}`;
  if (line.playedAt) return `time:${line.playedAt.getTime()}`;
  return null;
}

function resolveAssignmentSegment(
  playerId: string,
  teamId: string,
  role: string,
  roster: readonly TournamentRosterIdentity[],
  lines: readonly WeeklyFantasyLine[],
): AssignmentSegmentContribution {
  const ownLines = lines.filter((line) =>
    samePlayerNameplate(line.playerId, playerId)
      && line.teamId === teamId
      && lineMatchesRole(line, role),
  );
  const rawPoints = ownLines.reduce((sum, line) => sum + line.points, 0);
  const pointsPerGame = average(ownLines.map((line) => line.points));
  const substituteNameplates = new Set(roster
    .filter((player) => !samePlayerNameplate(player.playerId, playerId) && player.teamId === teamId && player.role === role)
    .map((player) => playerNameplateKey(player.playerId)));
  const ownGameKeys = new Set(ownLines.flatMap((line) => {
    const key = lineGameKey(line);
    return key ? [key] : [];
  }));
  const substituteLines = lines.filter((line) => {
    if (
      line.teamId !== teamId
      || !lineMatchesRole(line, role)
      || !substituteNameplates.has(playerNameplateKey(line.playerId))
    ) return false;
    const gameKey = lineGameKey(line);
    // Production scoring lines always carry a game id. For older callers that
    // do not identify games, preserve the conservative behavior: a player who
    // has any own line is treated as having played instead of assuming that an
    // undated same-role line came from a different game.
    return gameKey ? !ownGameKeys.has(gameKey) : ownLines.length === 0;
  });
  const teamLines = lines.filter((line) => line.teamId === teamId);
  if (substituteLines.length === 0) {
    return {
      creditedGames: ownLines.length || teamGameCount(teamLines),
      contribution: {
        gamesPlayed: ownLines.length,
        rawPoints,
        pointsPerGame,
        creditedPoints: pointsPerGame,
        fallback: null,
      },
    };
  }

  const substitutePointsPerGame = average(substituteLines.map((line) => line.points));
  const teamAveragePointsPerGame = average(teamLines.map((line) => line.points));
  const fallbackCredit = Math.min(substitutePointsPerGame, teamAveragePointsPerGame);
  const creditedGames = ownLines.length + substituteLines.length;
  const creditedPoints = creditedGames > 0
    ? (rawPoints + fallbackCredit * substituteLines.length) / creditedGames
    : 0;
  return {
    creditedGames,
    contribution: {
      gamesPlayed: ownLines.length,
      rawPoints,
      pointsPerGame,
      creditedPoints,
      fallback: {
        reason: "DID_NOT_PLAY",
        teamId,
        role,
        substitutePlayerIds: [...new Set(substituteLines.map((line) => line.playerId))],
        substitutePointsPerGame,
        teamAveragePointsPerGame,
        creditedPoints: fallbackCredit,
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
  const identity = roster.find((player) => player.playerId === playerId)
    ?? roster.find((player) => samePlayerNameplate(player.playerId, playerId));
  const currentTeamId = assignmentException?.currentTeamId ?? identity?.teamId;
  const role = assignmentException?.role ?? identity?.role;
  if (!currentTeamId || !role) {
    const ownLines = lines.filter((line) => samePlayerNameplate(line.playerId, playerId));
    const rawPoints = ownLines.reduce((sum, line) => sum + line.points, 0);
    const pointsPerGame = average(ownLines.map((line) => line.points));
    return {
      gamesPlayed: ownLines.length,
      rawPoints,
      pointsPerGame,
      creditedPoints: pointsPerGame,
      fallback: null,
    };
  }

  if (!assignmentException) {
    return resolveAssignmentSegment(playerId, currentTeamId, role, roster, lines).contribution;
  }

  const isBeforeEffective = (line: WeeklyFantasyLine) => {
    const playedAt = line.playedAt?.getTime();
    return playedAt !== undefined
      && playedAt !== null
      && playedAt < assignmentException.effectiveAt.getTime();
  };
  const before = resolveAssignmentSegment(
    assignmentException.previousPlayerId ?? playerId,
    assignmentException.previousTeamId,
    assignmentException.role,
    roster,
    lines.filter(isBeforeEffective),
  );
  const after = resolveAssignmentSegment(
    playerId,
    assignmentException.currentTeamId,
    assignmentException.role,
    roster,
    lines.filter((line) => !isBeforeEffective(line)),
  );
  const gamesPlayed = before.contribution.gamesPlayed + after.contribution.gamesPlayed;
  const rawPoints = before.contribution.rawPoints + after.contribution.rawPoints;
  const fallbackSegments = [before, after].filter(
    (segment): segment is AssignmentSegmentContribution & {
      contribution: RosterWeekContribution & { fallback: NonNullable<RosterWeekContribution["fallback"]> };
    } => Boolean(segment.contribution.fallback),
  );
  if (gamesPlayed === 0 && fallbackSegments.length > 0) {
    const fallbackGames = fallbackSegments.reduce((sum, segment) => sum + segment.creditedGames, 0);
    const weightedFallbackAverage = (field: "substitutePointsPerGame" | "teamAveragePointsPerGame") =>
      fallbackGames > 0
        ? fallbackSegments.reduce(
            (sum, segment) => sum + segment.contribution.fallback[field] * segment.creditedGames,
            0,
          ) / fallbackGames
        : 0;
    const substitutePointsPerGame = weightedFallbackAverage("substitutePointsPerGame");
    const teamAveragePointsPerGame = weightedFallbackAverage("teamAveragePointsPerGame");
    const creditedPoints = Math.min(substitutePointsPerGame, teamAveragePointsPerGame);
    return {
      gamesPlayed: 0,
      rawPoints: 0,
      pointsPerGame: 0,
      creditedPoints,
      fallback: {
        reason: "DID_NOT_PLAY",
        teamId: assignmentException.currentTeamId,
        role: assignmentException.role,
        substitutePlayerIds: [...new Set(fallbackSegments.flatMap(
          (segment) => segment.contribution.fallback.substitutePlayerIds,
        ))],
        substitutePointsPerGame,
        teamAveragePointsPerGame,
        creditedPoints,
      },
    };
  }
  const creditedGames = before.creditedGames + after.creditedGames;
  const creditedPoints = creditedGames > 0
    ? (
        before.contribution.creditedPoints * before.creditedGames
        + after.contribution.creditedPoints * after.creditedGames
      ) / creditedGames
    : 0;
  return {
    gamesPlayed,
    rawPoints,
    pointsPerGame: gamesPlayed > 0 ? rawPoints / gamesPlayed : 0,
    creditedPoints,
    fallback: after.contribution.fallback ?? before.contribution.fallback,
  };
}
