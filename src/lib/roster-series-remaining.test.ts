import assert from "node:assert/strict";
import test from "node:test";
import { buildRosterSeriesRemaining } from "./roster-series-remaining";

const completeGame = (team1: string, team2: string) => ({
  playerStats: [
    ...Array.from({ length: 5 }, () => ({ teamId: team1 })),
    ...Array.from({ length: 5 }, () => ({ teamId: team2 })),
  ],
});

test("groups cumulative missing player-series across frozen weekly rosters", () => {
  const [remaining] = buildRosterSeriesRemaining({
    tournamentId: "LCK/2026 Season/Rounds 3-4",
    throughWeekNumber: 2,
    fantasyTeams: [{ id: 1, username: "Ryan" }],
    rosterIdentities: [
      { playerId: "Smash", playerName: "Smash", teamId: "Dplus Kia" },
      { playerId: "Chovy", playerName: "Chovy", teamId: "Gen.G" },
      { playerId: "Effort", playerName: "Effort", teamId: "Nongshim RedForce" },
      { playerId: "LazyFeel", playerName: "LazyFeel", teamId: "Kiwoom DRX" },
      { playerId: "Jiwoo", playerName: "Jiwoo", teamId: "KT Rolster" },
      { playerId: "Faker", playerName: "Faker", teamId: "T1" },
    ],
    leagueWeeks: [
      {
        week: {
          number: 1,
          matches: [
            {
              id: "week-1-gen-dk",
              team1: "Gen.G",
              team2: "Dplus Kia",
              scheduledAt: new Date("2026-08-01T08:00:00.000Z"),
              winner: "Dplus Kia",
              team1Score: 0,
              team2Score: 2,
              games: [],
            },
            {
              id: "week-1-t1-hle",
              team1: "T1",
              team2: "Hanwha Life Esports",
              scheduledAt: new Date("2026-08-02T08:00:00.000Z"),
              winner: "T1",
              team1Score: 2,
              team2Score: 0,
              games: [completeGame("T1", "Hanwha Life Esports"), completeGame("T1", "Hanwha Life Esports")],
            },
          ],
        },
        weeklyRosters: [
          { fantasyTeamId: 1, playerId: "Smash" },
          { fantasyTeamId: 1, playerId: "Chovy" },
          { fantasyTeamId: 1, playerId: "Faker" },
        ],
      },
      {
        week: {
          number: 2,
          matches: [
            {
              id: "week-2-dk-kt",
              team1: "Dplus Kia",
              team2: "KT Rolster",
              scheduledAt: new Date("2026-08-09T08:00:00.000Z"),
              winner: null,
              team1Score: null,
              team2Score: null,
              games: [],
            },
            {
              id: "week-2-ns-dns",
              team1: "Nongshim RedForce",
              team2: "DN SOOPers",
              scheduledAt: new Date("2026-08-08T08:00:00.000Z"),
              winner: null,
              team1Score: null,
              team2Score: null,
              games: [],
            },
          ],
        },
        weeklyRosters: [
          { fantasyTeamId: 1, playerId: "Smash" },
          { fantasyTeamId: 1, playerId: "Effort" },
          // Ryan's frozen database slot can still contain LazyFeel, but series
          // after July 30 belong to the commissioner-approved Jiwoo assignment.
          { fantasyTeamId: 1, playerId: "LazyFeel" },
        ],
      },
    ],
  });

  assert.equal(remaining.count, 5);
  assert.deepEqual(remaining.series.map((group) => ({
    matchId: group.matchId,
    week: group.weekNumber,
    players: group.players.map((player) => player.playerId),
  })), [
    { matchId: "week-1-gen-dk", week: 1, players: ["Chovy", "Smash"] },
    { matchId: "week-2-ns-dns", week: 2, players: ["Effort"] },
    { matchId: "week-2-dk-kt", week: 2, players: ["Jiwoo", "Smash"] },
  ]);
});

test("does not expose frozen roster weeks after the selected cursor", () => {
  const [remaining] = buildRosterSeriesRemaining({
    tournamentId: "LCK/2026 Season/Rounds 3-4",
    throughWeekNumber: 1,
    fantasyTeams: [{ id: 1, username: "Ryan" }],
    rosterIdentities: [{ playerId: "Smash", playerName: "Smash", teamId: "Dplus Kia" }],
    leagueWeeks: [{
      week: {
        number: 2,
        matches: [{
          id: "future",
          team1: "Dplus Kia",
          team2: "KT Rolster",
          scheduledAt: new Date("2026-08-09T08:00:00.000Z"),
          winner: null,
          team1Score: null,
          team2Score: null,
          games: [],
        }],
      },
      weeklyRosters: [{ fantasyTeamId: 1, playerId: "Smash" }],
    }],
  });

  assert.equal(remaining.count, 0);
  assert.deepEqual(remaining.series, []);
});
