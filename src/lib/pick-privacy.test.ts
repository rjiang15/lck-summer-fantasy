import assert from "node:assert/strict";
import test from "node:test";
import { areWeeklyPicksPublic } from "./pick-privacy";

test("open weekly picks stay private before the commissioner locks them", () => {
  assert.equal(areWeeklyPicksPublic({ status: "OPEN", picksLockedAt: null }), false);
});

test("weekly picks become public as soon as the commissioner locks them", () => {
  assert.equal(areWeeklyPicksPublic({ status: "OPEN", picksLockedAt: new Date() }), true);
  assert.equal(areWeeklyPicksPublic({ status: "LOCKED", picksLockedAt: new Date() }), true);
});

test("completed weekly picks remain public through results and publication", () => {
  for (const status of ["RESULTS_IMPORTED", "SCORED", "PUBLISHED"]) {
    assert.equal(areWeeklyPicksPublic({ status, picksLockedAt: null }), true);
  }
});
