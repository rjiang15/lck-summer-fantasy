import assert from "node:assert/strict";
import test from "node:test";
import { canReplaceWeeklyRosterSnapshot } from "./season";

test("an open week can prepare or repair its roster snapshot before picks lock", () => {
  assert.equal(canReplaceWeeklyRosterSnapshot({ status: "OPEN", picksLockedAt: null }), true);
});

test("a locked or historical weekly roster snapshot cannot be replaced", () => {
  const lockedAt = new Date();
  assert.equal(canReplaceWeeklyRosterSnapshot({ status: "OPEN", picksLockedAt: lockedAt }), false);
  assert.equal(canReplaceWeeklyRosterSnapshot({ status: "LOCKED", picksLockedAt: lockedAt }), false);
  assert.equal(canReplaceWeeklyRosterSnapshot({ status: "RESULTS_IMPORTED", picksLockedAt: lockedAt }), false);
  assert.equal(canReplaceWeeklyRosterSnapshot({ status: "SCORED", picksLockedAt: lockedAt }), false);
  assert.equal(canReplaceWeeklyRosterSnapshot({ status: "PUBLISHED", picksLockedAt: lockedAt }), false);
});
