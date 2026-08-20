import assert from "node:assert/strict";
import test from "node:test";
import fixture from "@/data/manual-series/2026-08-01-gen-dk.json";
import { DEFAULT_SCORING, playerGamePoints } from "./scoring";

test("the Gen.G-DK reconciliation contains two complete games and excludes corrupt GoL 80675", () => {
  assert.equal(fixture.games.length, 2);
  assert.equal(fixture.games.some((game) => game.id === "gol:80675"), false);
  assert.equal(fixture.games[1].id, "gol:80676");
  for (const game of fixture.games) {
    assert.equal(game.players.length, 10);
    assert.equal(game.teams.length, 2);
    assert.equal(game.drafts.length, 20);
  }
});

test("Game 1 keeps provisional estimates and zero-filled missing categories explicit", () => {
  const game = fixture.games[0];
  for (const player of game.players) {
    assert.equal(player.damage, 0);
    assert.equal(player.damageToTowers, 0);
    assert.equal(player.damageMitigated, 0);
    assert.equal(player.totalHeal, 0);
    assert.ok(player.visionScore > 0);
    assert.ok("provisional" in player);
  }
  for (const [left, right] of [[0, 5], [1, 6], [2, 7], [3, 8], [4, 9]]) {
    assert.equal(game.players[left].laneAt15.xpDiff + game.players[right].laneAt15.xpDiff, 0);
  }
});

test("the deployable fixture reproduces the reviewed per-game fantasy scores", () => {
  const expected = new Map([
    ["1:Kiin", 22.55], ["1:Canyon", 5.33], ["1:Chovy", 15.89], ["1:Ruler", -1.38], ["1:Duro", 18.36],
    ["1:Siwoo", 0.78], ["1:Lucid", 44.57], ["1:ShowMaker", 30.56], ["1:Smash", 36.78], ["1:Career", 21.71],
    ["2:Kiin", 22.16], ["2:Canyon", 9.70], ["2:Chovy", 13.51], ["2:Ruler", 13.47], ["2:Duro", 20.11],
    ["2:Siwoo", 0.78], ["2:Lucid", 35.61], ["2:ShowMaker", 25.50], ["2:Smash", 19.66], ["2:Career", 32.84],
  ]);

  for (const game of fixture.games) {
    for (const player of game.players) {
      const team = game.teams.find((row) => row.team === player.team);
      assert.ok(team);
      assert.equal(playerGamePoints(player, DEFAULT_SCORING, {
        lengthSec: game.lengthSec,
        teamObjectives: team,
        laneAt15: player.laneAt15,
      }), expected.get(`${game.gameNumber}:${player.player}`));
    }
  }
});
