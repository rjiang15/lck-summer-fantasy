import assert from "node:assert/strict";
import test from "node:test";
import { isResearchSeasonVisible } from "./tournaments";

const past = { id: "rounds-1-2", seasonOrder: 1, dateStart: new Date("2026-04-01") };
const current = { id: "rounds-3-4", seasonOrder: 2, dateStart: new Date("2026-07-29") };

test("current leagues can research their own and past seasons", () => {
  assert.equal(isResearchSeasonVisible(current, current), true);
  assert.equal(isResearchSeasonVisible(past, current), true);
});

test("past leagues cannot see a season from their future", () => {
  assert.equal(isResearchSeasonVisible(current, past), false);
});

test("legacy catalogs fall back to season start dates", () => {
  assert.equal(isResearchSeasonVisible(
    { ...past, seasonOrder: 0 },
    { ...current, seasonOrder: 0 },
  ), true);
});
