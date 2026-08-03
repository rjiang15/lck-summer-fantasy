import assert from "node:assert/strict";
import test from "node:test";
import {
  areWeekSeriesResultsComplete,
  canManageFutureRosters,
  canOpenWeekPicks,
  canUnlockWeekPicks,
  shouldOpenNextWeekOnPublication,
  type SeriesResult,
} from "./week-progression";

const finished: SeriesResult[] = [{
  bestOf: 3,
  team1: "Gen.G",
  team2: "Dplus Kia",
  winner: "Gen.G",
  team1Score: 2,
  team2Score: 1,
}];

test("series results can be complete without any detailed game stats", () => {
  assert.equal(areWeekSeriesResultsComplete(finished), true);
  assert.equal(areWeekSeriesResultsComplete([{ ...finished[0], winner: null }]), false);
  assert.equal(areWeekSeriesResultsComplete([{ ...finished[0], team1Score: 1 }]), false);
  assert.equal(areWeekSeriesResultsComplete([]), false);
});

test("the next Pick'em slate can open from locked final series results before stats are published", () => {
  const lockedAt = new Date("2026-08-02T12:00:00.000Z");
  const previous = {
    status: "LOCKED",
    picksLockedAt: lockedAt,
    rosterLockedAt: lockedAt,
    week: { number: 1, matches: finished },
  };
  const candidate = {
    status: "UPCOMING",
    picksLockedAt: null,
    rosterLockedAt: null,
    week: { number: 2, matches: [] },
  };
  assert.equal(canOpenWeekPicks(candidate, previous), true);
  assert.equal(canOpenWeekPicks(candidate, { ...previous, picksLockedAt: null }), false);
  assert.equal(canOpenWeekPicks(candidate, {
    ...previous,
    week: { number: 1, matches: [{ ...finished[0], team2Score: null }] },
  }), false);
});

test("final results or a later opened slate make prior picks immutable", () => {
  const lockedAt = new Date("2026-08-02T12:00:00.000Z");
  assert.equal(canUnlockWeekPicks({ status: "LOCKED", picksLockedAt: lockedAt, matches: finished }, false), false);
  assert.equal(canUnlockWeekPicks({
    status: "LOCKED",
    picksLockedAt: lockedAt,
    matches: [{ ...finished[0], winner: null }],
  }, true), false);
  assert.equal(canUnlockWeekPicks({
    status: "LOCKED",
    picksLockedAt: lockedAt,
    matches: [{ ...finished[0], winner: null }],
  }, false), true);
});

test("publishing an older week never reopens an already-open or locked next week", () => {
  assert.equal(shouldOpenNextWeekOnPublication("UPCOMING"), true);
  assert.equal(shouldOpenNextWeekOnPublication("OPEN"), false);
  assert.equal(shouldOpenNextWeekOnPublication("LOCKED"), false);
});

test("opening Week 2 enables future-roster management before Week 1 stats publish", () => {
  assert.equal(canManageFutureRosters(0, 1), false);
  assert.equal(canManageFutureRosters(0, 2), true);
  assert.equal(canManageFutureRosters(1, null), true);
});
