import assert from "node:assert/strict";
import test from "node:test";
import { recordChanged } from "./change-aware-write";

test("change-aware ingestion treats equal scalar and date values as unchanged", () => {
  const stored = {
    name: "Week 1",
    score: 2,
    winner: null,
    scheduledAt: new Date("2026-07-29T08:00:00Z"),
  };
  assert.equal(recordChanged(stored, {
    name: "Week 1",
    score: 2,
    winner: null,
    scheduledAt: new Date("2026-07-29T08:00:00Z"),
  }), false);
});

test("change-aware ingestion detects a newly completed result", () => {
  assert.equal(recordChanged(
    { winner: null, team1Score: 0 },
    { winner: "DRX", team1Score: 2 },
  ), true);
});
