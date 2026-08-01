import assert from "node:assert/strict";
import test from "node:test";
import { pendingScoreboardMatches } from "./ingest-completeness";

test("reports a completed series whose scoreboards have not been published", () => {
  assert.deepEqual(pendingScoreboardMatches([
    {
      MatchId: "week-1-match-2",
      Team1: "Gen.G",
      Team2: "Dplus Kia",
      Winner: "2",
      Team1Score: "0",
      Team2Score: "2",
    },
  ], [], []), [{
    matchId: "week-1-match-2",
    label: "Gen.G vs Dplus Kia",
    expectedGames: 2,
    gamesFound: 0,
    expectedPlayerLines: 20,
    playerLinesFound: 0,
  }]);
});

test("reports player-table lag after game rows arrive", () => {
  const games = [
    { MatchId: "match", GameId: "game-1" },
    { MatchId: "match", GameId: "game-2" },
  ];
  const players = Array.from({ length: 10 }, () => ({ GameId: "game-1" }));
  assert.deepEqual(pendingScoreboardMatches([
    { MatchId: "match", Team1: "NS", Team2: "BFX", Winner: "1", Team1Score: "2", Team2Score: "0" },
  ], games, players), [{
    matchId: "match",
    label: "NS vs BFX",
    expectedGames: 2,
    gamesFound: 2,
    expectedPlayerLines: 20,
    playerLinesFound: 10,
  }]);
});

test("ignores unfinished and fully published matches", () => {
  const completeGames = [
    { MatchId: "complete", GameId: "game-1" },
    { MatchId: "complete", GameId: "game-2" },
  ];
  const completePlayers = completeGames.flatMap((game) =>
    Array.from({ length: 10 }, () => ({ GameId: game.GameId })),
  );
  assert.deepEqual(pendingScoreboardMatches([
    { MatchId: "future", Team1: "A", Team2: "B", Winner: "", Team1Score: "", Team2Score: "" },
    { MatchId: "complete", Team1: "C", Team2: "D", Winner: "1", Team1Score: "2", Team2Score: "0" },
  ], completeGames, completePlayers), []);
});
