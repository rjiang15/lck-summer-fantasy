import assert from "node:assert/strict";
import test from "node:test";
import { advancedScoreAvailability } from "./advanced-stat-coverage";

test("Leaguepedia-only rows do not masquerade as complete advanced scoring", () => {
  assert.deepEqual(advancedScoreAvailability({
    role: "Support",
    damageShare: 0.05,
    goldShare: 0.12,
    wardsKilled: null,
    controlWardsBought: null,
    damageToTowers: null,
    damageMitigated: null,
    tripleKills: null,
    quadraKills: null,
    pentakills: 0,
  }, null), {
    efficiency: false,
    laneImpact: false,
    towerPressure: false,
    durability: false,
    multikill: false,
  });
});

test("zero-valued enriched inputs count as available measurements", () => {
  assert.deepEqual(advancedScoreAvailability({
    role: "Support",
    wardsKilled: 0,
    controlWardsBought: 0,
    damageToTowers: 0,
    damageMitigated: 0,
    tripleKills: 0,
    quadraKills: 0,
    pentakills: 0,
  }, { csDiff: 0, goldDiff: 0, xpDiff: 0 }), {
    efficiency: true,
    laneImpact: true,
    towerPressure: true,
    durability: true,
    multikill: true,
  });
});

test("lane impact requires all three 15-minute differentials", () => {
  assert.equal(advancedScoreAvailability({}, { csDiff: 1, goldDiff: 100, xpDiff: null }).laneImpact, false);
});

test("carry efficiency is available from damage and gold shares", () => {
  assert.equal(advancedScoreAvailability({
    role: "Mid",
    damageShare: 0.3,
    goldShare: 0.25,
  }, null).efficiency, true);
});
