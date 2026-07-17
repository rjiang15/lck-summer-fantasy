import assert from "node:assert/strict";
import test from "node:test";
import { snakeTeamId, totalDraftPicks } from "./draft";

test("snake order reverses every round", () => {
  const order = [10, 20, 30];
  assert.deepEqual(Array.from({ length: 9 }, (_, pick) => snakeTeamId(order, pick)), [
    10, 20, 30, 30, 20, 10, 10, 20, 30,
  ]);
});

test("ten-player rosters require two picks at each of five roles", () => {
  assert.equal(totalDraftPicks(3, 2), 30);
});
