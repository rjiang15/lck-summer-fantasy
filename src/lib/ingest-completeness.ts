export type ScheduledResultRow = {
  MatchId?: string;
  Team1?: string;
  Team2?: string;
  Winner?: string;
  Team1Score?: string;
  Team2Score?: string;
};

export type GameSourceRow = {
  GameId?: string;
  MatchId?: string;
};

export type PlayerSourceRow = {
  GameId?: string;
};

export type PendingScoreboardMatch = {
  matchId: string;
  label: string;
  expectedGames: number;
  gamesFound: number;
  expectedPlayerLines: number;
  playerLinesFound: number;
};

const positiveScore = (value: string | undefined) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

/**
 * MatchSchedule is often updated before Leaguepedia publishes ScoreboardGames
 * and ScoreboardPlayers. Report that lag explicitly so a successful live
 * refresh is not mistaken for a complete one.
 */
export function pendingScoreboardMatches(
  schedule: ScheduledResultRow[],
  games: GameSourceRow[],
  players: PlayerSourceRow[],
): PendingScoreboardMatch[] {
  const gamesByMatch = new Map<string, GameSourceRow[]>();
  for (const game of games) {
    if (!game.MatchId) continue;
    const rows = gamesByMatch.get(game.MatchId) ?? [];
    rows.push(game);
    gamesByMatch.set(game.MatchId, rows);
  }

  const playersByGame = new Map<string, number>();
  for (const player of players) {
    if (!player.GameId) continue;
    playersByGame.set(player.GameId, (playersByGame.get(player.GameId) ?? 0) + 1);
  }

  const pending: PendingScoreboardMatch[] = [];
  for (const match of schedule) {
    if (!match.MatchId || !match.Winner) continue;
    const team1Score = positiveScore(match.Team1Score);
    const team2Score = positiveScore(match.Team2Score);
    if (team1Score === null || team2Score === null) continue;
    const expectedGames = team1Score + team2Score;
    if (expectedGames === 0) continue;

    const matchGames = gamesByMatch.get(match.MatchId) ?? [];
    const playerLinesFound = matchGames.reduce(
      (total, game) => total + (game.GameId ? playersByGame.get(game.GameId) ?? 0 : 0),
      0,
    );
    const expectedPlayerLines = expectedGames * 10;
    if (matchGames.length >= expectedGames && playerLinesFound >= expectedPlayerLines) continue;

    pending.push({
      matchId: match.MatchId,
      label: `${match.Team1 || "Team 1"} vs ${match.Team2 || "Team 2"}`,
      expectedGames,
      gamesFound: matchGames.length,
      expectedPlayerLines,
      playerLinesFound,
    });
  }
  return pending;
}
