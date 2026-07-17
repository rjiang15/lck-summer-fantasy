import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCORING,
  pickemPoints,
  playerGamePoints,
  playerGameScore,
  playerPointsPerGame,
} from "./scoring";
import { validSeriesPrediction } from "./season";

test("KP and carry efficiency are primary scoring components", () => {
  const score = playerGameScore({
    kills: 5,
    deaths: 2,
    assists: 7,
    cs: 300,
    visionScore: 20,
    won: true,
    role: "Mid",
    teamKills: 15,
    damageShare: 0.3,
    goldShare: 0.2,
  }, DEFAULT_SCORING, { lengthSec: 1800 });

  assert.equal(score.combat, 8);
  assert.equal(score.killParticipation, 10);
  assert.equal(score.efficiency, 15);
  assert.equal(score.total, 38.2);
});

test("KP uses broad 50, 65, and 80 percent buckets", () => {
  const base = {
    kills: 1, deaths: 1, assists: 1, cs: null, visionScore: null, won: false,
    role: "Mid", damageShare: null, goldShare: null,
  };
  assert.equal(playerGameScore({ ...base, killParticipation: 0.49 }, DEFAULT_SCORING).killParticipation, 0);
  assert.equal(playerGameScore({ ...base, killParticipation: 0.5 }, DEFAULT_SCORING).killParticipation, 3);
  assert.equal(playerGameScore({ ...base, killParticipation: 0.65 }, DEFAULT_SCORING).killParticipation, 6);
  assert.equal(playerGameScore({ ...base, killParticipation: 0.8 }, DEFAULT_SCORING).killParticipation, 10);
});

test("support efficiency uses LCK-calibrated normalized vision instead of damage share", () => {
  const score = playerGameScore({
    kills: 0,
    deaths: 2,
    assists: 12,
    cs: 30,
    visionScore: 145,
    won: true,
    role: "Support",
    killParticipation: 0.8,
    damageShare: 0.04,
    goldShare: 0.13,
  }, DEFAULT_SCORING, { lengthSec: 1800 });

  assert.equal(score.efficiency, 15);
  assert.equal(score.total, 37.38);
});

test("top lane receives role-appropriate broad KP buckets", () => {
  const base = {
    kills: 1, deaths: 1, assists: 1, cs: null, visionScore: null, won: false,
    role: "Top", damageShare: null, goldShare: null,
  };
  assert.equal(playerGameScore({ ...base, killParticipation: 0.34 }, DEFAULT_SCORING).killParticipation, 0);
  assert.equal(playerGameScore({ ...base, killParticipation: 0.35 }, DEFAULT_SCORING).killParticipation, 3);
  assert.equal(playerGameScore({ ...base, killParticipation: 0.5 }, DEFAULT_SCORING).killParticipation, 6);
  assert.equal(playerGameScore({ ...base, killParticipation: 0.65 }, DEFAULT_SCORING).killParticipation, 10);
});

test("junglers receive team objective proxy points", () => {
  const score = playerGameScore({
    kills: 3,
    deaths: 1,
    assists: 8,
    cs: 180,
    visionScore: 30,
    won: true,
    role: "Jungle",
    killParticipation: 0.7,
    damageShare: 0.2,
    goldShare: 0.2,
  }, DEFAULT_SCORING, {
    lengthSec: 1800,
    teamObjectives: { dragons: 3, elderDragons: 0, barons: 1, heralds: 1, voidGrubs: 3 },
  });

  assert.equal(score.jungleObjectives, 4.5);
  assert.equal(score.efficiency, 10);
  assert.equal(score.total, 32.85);
});

test("farm and vision normalize to a 30-minute game", () => {
  const base = {
    kills: 0, deaths: 0, assists: 0, won: false, role: "Top",
    teamKills: null, killParticipation: null, damageShare: null, goldShare: null,
  };
  const short = playerGamePoints({ ...base, cs: 200, visionScore: 20 }, DEFAULT_SCORING, { lengthSec: 1200 });
  const long = playerGamePoints({ ...base, cs: 300, visionScore: 30 }, DEFAULT_SCORING, { lengthSec: 1800 });
  assert.equal(short, long);
});

test("official player value is points per game rather than raw games played", () => {
  assert.equal(playerPointsPerGame([30, 20]), 25);
  assert.equal(playerPointsPerGame([30, 20, 25]), 25);
  assert.equal(playerPointsPerGame([]), 0);
});

test("pickems award winner and exact-score points independently", () => {
  assert.equal(pickemPoints("T1", "2-1", "T1", "2-1", DEFAULT_SCORING), 15);
  assert.equal(pickemPoints("T1", "2-0", "T1", "2-1", DEFAULT_SCORING), 10);
  assert.equal(pickemPoints("GEN", "1-2", "T1", "2-1", DEFAULT_SCORING), 0);
});

test("series prediction validation rejects forged winners and impossible scores", () => {
  assert.equal(validSeriesPrediction(3, "T1", "GEN", "T1", "2-1"), true);
  assert.equal(validSeriesPrediction(3, "T1", "GEN", "GEN", "2-1"), false);
  assert.equal(validSeriesPrediction(3, "T1", "GEN", "T1", "3-0"), false);
  assert.equal(validSeriesPrediction(5, "T1", "GEN", "GEN", "2-3"), true);
});
