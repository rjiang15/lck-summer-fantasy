import assert from "node:assert/strict";
import test from "node:test";
import { initialLeagueWeekRows } from "./league-setup";

test("new leagues attach the complete schedule but open only Week 1", () => {
  const openedAt = new Date("2026-07-17T12:00:00Z");
  const rows = initialLeagueWeekRows(12, [{ id: 101 }, { id: 102 }, { id: 103 }], openedAt);
  assert.deepEqual(rows, [
    { leagueId: 12, weekId: 101, status: "OPEN", picksOpenAt: openedAt },
    { leagueId: 12, weekId: 102, status: "UPCOMING", picksOpenAt: null },
    { leagueId: 12, weekId: 103, status: "UPCOMING", picksOpenAt: null },
  ]);
});
