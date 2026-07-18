import assert from "node:assert/strict";
import test from "node:test";
import { parseBackup } from "./backup-format";

const valid = {
  version: 7,
  exportedAt: "2026-07-18T00:00:00.000Z",
  league: {
    name: "Test League", tournamentId: "LCK/Test", scoringConfig: "{}", currentWeek: 0,
    seasonStatus: "PRESEASON", crystalBallLockedAt: null, rostersLockedAt: null, isSimulation: true,
  },
  users: [{ username: "owner", role: "OWNER" }],
  fantasyTeams: [{ username: "owner", name: "Owner Team", roster: [] }],
  draftPicks: [],
  pickems: [],
  cbQuestions: [],
  leagueWeeks: [],
};

test("v7 backups validate without account password hashes", () => {
  assert.equal(parseBackup(valid).version, 7);
  assert.equal("passwordHash" in parseBackup(valid).users[0], false);
});

test("backup validation rejects malformed ownership and linked usernames", () => {
  assert.throws(() => parseBackup({ ...valid, users: [{ username: "owner", role: "COMMISSIONER" }] }), /exactly one league owner/);
  assert.throws(() => parseBackup({ ...valid, fantasyTeams: [{ username: "missing", name: "Missing", roster: [] }] }), /unknown user/);
});

test("backup validation rejects invalid dates, non-finite scores, and oversized collections", () => {
  assert.throws(() => parseBackup({ ...valid, exportedAt: "tomorrow-ish" }), /valid date/);
  assert.throws(() => parseBackup({ ...valid, leagueWeeks: [{
    weekNumber: 1, status: "PUBLISHED", picksOpenAt: null, picksLockedAt: null, rosterLockedAt: null,
    resultsImportedAt: null, scoredAt: null, publishedAt: null, validationJson: null, validationError: null,
    rosters: [], scores: [{ username: "owner", rosterPts: Number.NaN, pickemPts: 0, total: 0, breakdown: "{}", publishedAt: null }],
  }] }), /finite number/);
  assert.throws(() => parseBackup({ ...valid, users: Array.from({ length: 501 }, (_, index) => ({ username: `user_${index}`, role: index === 0 ? "OWNER" : "PARTICIPANT" })) }), /safety limit/);
});
