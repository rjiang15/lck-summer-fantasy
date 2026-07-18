import assert from "node:assert/strict";
import test from "node:test";
import { rosterLockError } from "./roster-readiness";

const completeRoster = ["TOP", "JNG", "MID", "BOT", "SUP"].map((slot) => ({ slot }));

test("roster editing cannot lock before the initial draft", () => {
  assert.equal(rosterLockError({ currentWeek: 0, draftStatus: "NOT_STARTED", teams: [] }),
    "Complete the initial roster draft before locking roster editing");
});

test("roster editing requires participants and all five starting positions", () => {
  assert.match(rosterLockError({ currentWeek: 1, draftStatus: "COMPLETE", teams: [] })!, /at least one participant/);
  assert.match(rosterLockError({ currentWeek: 1, draftStatus: "COMPLETE", teams: [{ roster: [{ slot: "TOP" }] }] })!, /complete starting roster/);
  assert.equal(rosterLockError({ currentWeek: 1, draftStatus: "COMPLETE", teams: [{ roster: completeRoster }] }), null);
});
