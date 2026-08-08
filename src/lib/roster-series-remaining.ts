import { fantasyRosterTradeExceptionForRosterPlayer } from "./roster-trade-exceptions";

export type RemainingSeriesPlayer = {
  playerId: string;
  playerName: string;
  teamId: string;
};

export type RemainingRosterSeries = {
  matchId: string;
  weekNumber: number;
  scheduledAt: Date;
  team1: string;
  team2: string;
  players: RemainingSeriesPlayer[];
};

export type FantasyTeamSeriesRemaining = {
  fantasyTeamId: number;
  count: number;
  series: RemainingRosterSeries[];
};

type RosterIdentity = {
  playerId: string;
  playerName: string;
  teamId: string | null;
};

type SeriesMatch = {
  id: string;
  team1: string;
  team2: string;
  scheduledAt: Date;
  winner: string | null;
  team1Score: number | null;
  team2Score: number | null;
  games: Array<{
    playerStats: Array<{ teamId: string }>;
  }>;
};

type FrozenRosterWeek = {
  week: {
    number: number;
    matches: SeriesMatch[];
  };
  weeklyRosters: Array<{
    fantasyTeamId: number;
    playerId: string;
  }>;
};

type FantasyTeamRoster = {
  id: number;
  username: string;
};

type PopulatedRosterWeek = {
  weeklyRosters: readonly unknown[];
  week: {
    number: number;
    matches: ReadonlyArray<Pick<SeriesMatch, "winner" | "team1Score" | "team2Score" | "games">>;
  };
};

/**
 * Live leagues can move into a newer week while an older, incomplete series
 * prevents the commissioner cursor from advancing. Treat a frozen-roster week
 * as populated once any actual result or game row exists; schedule-only future
 * weeks must not move the leaderboard window forward.
 */
export function latestPopulatedRosterWeekNumber(
  leagueWeeks: readonly PopulatedRosterWeek[],
) {
  return leagueWeeks.reduce<number | null>((latest, leagueWeek) => {
    const hasSeriesData = leagueWeek.week.matches.some((match) =>
      match.winner !== null
      || match.team1Score !== null
      || match.team2Score !== null
      || match.games.length > 0,
    );
    if (leagueWeek.weeklyRosters.length === 0 || !hasSeriesData) return latest;
    return latest === null
      ? leagueWeek.week.number
      : Math.max(latest, leagueWeek.week.number);
  }, null);
}

function seriesDetailsComplete(match: SeriesMatch) {
  if (!match.winner || match.team1Score === null || match.team2Score === null) return false;
  const expectedGames = match.team1Score + match.team2Score;
  if (expectedGames <= 0 || match.games.length !== expectedGames) return false;
  return match.games.every((game) =>
    game.playerStats.filter((row) => row.teamId === match.team1).length === 5
    && game.playerStats.filter((row) => row.teamId === match.team2).length === 5,
  );
}

function assignmentForMatch({
  tournamentId,
  ownerUsername,
  rosterPlayerId,
  scheduledAt,
  identities,
}: {
  tournamentId: string;
  ownerUsername: string;
  rosterPlayerId: string;
  scheduledAt: Date;
  identities: Map<string, RosterIdentity>;
}): RemainingSeriesPlayer | null {
  const exception = fantasyRosterTradeExceptionForRosterPlayer(
    tournamentId,
    ownerUsername,
    rosterPlayerId,
  );
  if (exception) {
    const beforeEffective = scheduledAt < new Date(exception.effectiveAt);
    const playerId = beforeEffective
      ? exception.replacesPlayerId ?? rosterPlayerId
      : exception.playerId;
    const teamId = beforeEffective ? exception.previousTeamId : exception.currentTeamId;
    const fallbackName = beforeEffective
      ? exception.replacesPlayerName ?? exception.playerName
      : exception.playerName;
    return {
      playerId,
      playerName: identities.get(playerId)?.playerName ?? fallbackName,
      teamId,
    };
  }

  const identity = identities.get(rosterPlayerId);
  if (!identity?.teamId) return null;
  return {
    playerId: rosterPlayerId,
    playerName: identity.playerName,
    teamId: identity.teamId,
  };
}

/**
 * Counts one outstanding obligation per frozen roster player and incomplete
 * pro series. The display groups players who are waiting on the same series.
 */
export function buildRosterSeriesRemaining({
  tournamentId,
  throughWeekNumber,
  fantasyTeams,
  rosterIdentities,
  leagueWeeks,
}: {
  tournamentId: string;
  throughWeekNumber: number;
  fantasyTeams: readonly FantasyTeamRoster[];
  rosterIdentities: readonly RosterIdentity[];
  leagueWeeks: readonly FrozenRosterWeek[];
}): FantasyTeamSeriesRemaining[] {
  const identities = new Map(rosterIdentities.map((identity) => [identity.playerId, identity]));
  const trackedWeeks = leagueWeeks
    .filter((leagueWeek) =>
      leagueWeek.week.number <= throughWeekNumber && leagueWeek.weeklyRosters.length > 0,
    )
    .sort((left, right) => left.week.number - right.week.number);

  return fantasyTeams.map((fantasyTeam) => {
    const remainingByMatch = new Map<string, RemainingRosterSeries>();
    for (const leagueWeek of trackedWeeks) {
      const roster = leagueWeek.weeklyRosters.filter(
        (slot) => slot.fantasyTeamId === fantasyTeam.id,
      );
      for (const match of leagueWeek.week.matches) {
        if (seriesDetailsComplete(match)) continue;
        for (const slot of roster) {
          const assignment = assignmentForMatch({
            tournamentId,
            ownerUsername: fantasyTeam.username,
            rosterPlayerId: slot.playerId,
            scheduledAt: match.scheduledAt,
            identities,
          });
          if (!assignment || ![match.team1, match.team2].includes(assignment.teamId)) continue;
          const group = remainingByMatch.get(match.id) ?? {
            matchId: match.id,
            weekNumber: leagueWeek.week.number,
            scheduledAt: match.scheduledAt,
            team1: match.team1,
            team2: match.team2,
            players: [],
          };
          if (!group.players.some((player) => player.playerId === assignment.playerId)) {
            group.players.push(assignment);
          }
          remainingByMatch.set(match.id, group);
        }
      }
    }

    const series = [...remainingByMatch.values()]
      .map((group) => ({
        ...group,
        players: group.players.sort((left, right) => left.playerName.localeCompare(right.playerName)),
      }))
      .sort((left, right) =>
        left.weekNumber - right.weekNumber
        || left.scheduledAt.getTime() - right.scheduledAt.getTime()
        || left.matchId.localeCompare(right.matchId),
      );
    return {
      fantasyTeamId: fantasyTeam.id,
      count: series.reduce((sum, group) => sum + group.players.length, 0),
      series,
    };
  });
}
