import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SCORING, pickemPoints, playerGamePoints } from "./scoring";
import { validSeriesPrediction } from "./season";

test("player scoring is deterministic and includes configured bonuses", () => {
  const points = playerGamePoints({ kills: 10, deaths: 2, assists: 8, cs: 200, visionScore: 30, won: true }, DEFAULT_SCORING);
  assert.equal(points, 46.5);
});

test("pickems award winner and exact-score points independently", () => {
  assert.equal(pickemPoints("T1", "2-1", "T1", "2-1", DEFAULT_SCORING), 3);
  assert.equal(pickemPoints("T1", "2-0", "T1", "2-1", DEFAULT_SCORING), 2);
  assert.equal(pickemPoints("GEN", "1-2", "T1", "2-1", DEFAULT_SCORING), 0);
});

test("series prediction validation rejects forged winners and impossible scores", () => {
  assert.equal(validSeriesPrediction(3, "T1", "GEN", "T1", "2-1"), true);
  assert.equal(validSeriesPrediction(3, "T1", "GEN", "GEN", "2-1"), false);
  assert.equal(validSeriesPrediction(3, "T1", "GEN", "T1", "3-0"), false);
  assert.equal(validSeriesPrediction(5, "T1", "GEN", "GEN", "2-3"), true);
});
